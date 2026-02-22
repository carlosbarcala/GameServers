const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const {
  BASE_DIR,
  DOWNLOADS_DIR,
  GAMES,
  INSTANCES_DIR,
  STATE_FILE
} = require("./config");
const isDev = process.env.NODE_ENV === "development";

const activeTailers = new Map();

async function ensureRuntimeContext() {
  const username = os.userInfo().username;
  const cwd = process.cwd();

  // En desarrollo, omitir validaciones de usuario y directorio
  if (!isDev) {
    if (username !== "games") {
      throw new Error('Este proceso debe ejecutarse con el usuario "games".');
    }

    if (!cwd.startsWith(`${BASE_DIR}/`) && cwd !== BASE_DIR) {
      throw new Error(`Este proceso debe ejecutarse desde ${BASE_DIR}/`);
    }
  }

  await fs.mkdir(INSTANCES_DIR, { recursive: true });
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true });

  if (isDev) {
    console.log("🔧 Modo DESARROLLO activado");
    console.log(`📁 Directorio base: ${BASE_DIR}`);
    console.log(`📁 Instancias: ${INSTANCES_DIR}`);
  }
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function getGame(id) {
  const game = GAMES[id];
  if (!game) {
    throw new Error(
      `Juego no soportado: "${id}". Usa: ${Object.keys(GAMES).join(", ")}`
    );
  }
  return game;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

async function stopGame(gameId, log = () => { }) {
  const state = await readState();
  const entry = state[gameId];

  // Verificar si hay una sesión de screen activa
  if (!entry?.screenName) {
    log(`${gameId}: No había sesión de screen activa`);
    return { ok: true, message: "No había sesión activa." };
  }

  const isRunning = await isScreenSessionAlive(entry.screenName);
  if (!isRunning) {
    log(`${gameId}: La sesión de screen ya no estaba activa`);
    delete state[gameId].screenName;
    await writeState(state);
    return { ok: true, message: "La sesión ya no estaba activa." };
  }

  log(`${gameId}: Deteniendo sesión de screen "${entry.screenName}"...`);

  try {
    // Enviar comando 'stop' al servidor (para servidores que lo soporten)
    try {
      await sendCommandToScreen(entry.screenName, "stop");
      log(`${gameId}: Comando 'stop' enviado, esperando cierre graceful...`);

      // Esperar hasta 10 segundos para que el servidor se cierre
      let retries = 20;
      while (retries > 0 && await isScreenSessionAlive(entry.screenName)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        retries -= 1;
      }
    } catch (error) {
      log(`${gameId}: No se pudo enviar comando stop: ${error.message}`);
    }

    // Si todavía está activo, forzar cierre de la sesión
    if (await isScreenSessionAlive(entry.screenName)) {
      log(`${gameId}: Forzando cierre de sesión de screen...`);
      await runCommand("screen", ["-S", entry.screenName, "-X", "quit"], BASE_DIR);
    }

    delete state[gameId].screenName;
    await writeState(state);

    // Detener log streaming
    stopLogStream(gameId);

    log(`${gameId}: Sesión de screen detenida correctamente`);
    return { ok: true, message: "Servidor detenido." };
  } catch (error) {
    log(`${gameId}: Error al detener sesión: ${error.message}`);
    throw error;
  }
}

function downloadFile(url, targetPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        return resolve(downloadFile(res.headers.location, targetPath));
      }

      if (res.statusCode !== 200) {
        return reject(
          new Error(`Descarga fallida (${res.statusCode}) para ${url}`)
        );
      }

      const file = fsSync.createWriteStream(targetPath);
      res.pipe(file);

      file.on("finish", () => {
        file.close(() => resolve());
      });
      file.on("error", reject);
    });

    req.on("error", reject);
  });
}

async function extractArchive(archivePath, targetDir) {
  if (archivePath.endsWith(".zip")) {
    await runCommand("unzip", ["-o", archivePath, "-d", targetDir], BASE_DIR);
    return;
  }

  if (archivePath.endsWith(".tar.gz")) {
    await runCommand("tar", ["-xzf", archivePath, "-C", targetDir], BASE_DIR);
    return;
  }

  throw new Error(`Formato no soportado para extracción: ${archivePath}`);
}

function runCommand(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: "ignore", detached: true });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Comando falló: ${bin} ${args.join(" ")}`));
      }
    });
    child.on("error", reject);
  });
}

async function startInstalledGame(gameId, log = () => { }) {
  const game = getGame(gameId);
  const instancePath = game.instanceDir;
  const state = await readState();

  // Nombre de la sesión de screen
  const screenName = `gameserver-${gameId}`;

  // Verificar si ya hay una sesión de screen activa
  if (state[gameId]?.screenName) {
    const isRunning = await isScreenSessionAlive(state[gameId].screenName);
    if (isRunning) {
      log(`${gameId}: Ya estaba ejecutándose en screen session ${state[gameId].screenName}`);
      return { ok: true, message: "Ya estaba ejecutándose.", screenName: state[gameId].screenName };
    }
  }

  log(`${gameId}: Iniciando servidor en screen session...`);

  // Usar parámetros personalizados si existen, sino usar los por defecto
  let launchArgs = [...game.launchCommand.args];

  if (state[gameId]?.params) {
    // Parsear parámetros personalizados y reemplazar los parámetros JVM
    const customParams = state[gameId].params.trim().split(/\s+/);

    // Filtrar los parámetros JVM por defecto (-Xms, -Xmx)
    launchArgs = launchArgs.filter(arg => !arg.startsWith("-Xms") && !arg.startsWith("-Xmx"));

    // Añadir parámetros personalizados al inicio
    launchArgs = [...customParams, ...launchArgs];

    log(`${gameId}: Usando parámetros personalizados: ${customParams.join(" ")}`);
  }

  // Construir el comando completo
  const fullCommand = `${game.launchCommand.bin} ${launchArgs.join(" ")}`;

  // Crear sesión de screen y ejecutar el comando
  // -dmS: crear sesión detached con nombre
  // -L: habilitar logging
  // -Logfile: especificar archivo de log
  const logFile = path.join(instancePath, "screen.log");

  try {
    await runCommand("screen", [
      "-dmS", screenName,
      "-L",
      "-Logfile", logFile,
      "bash", "-c",
      `cd ${instancePath} && ${fullCommand}`
    ], BASE_DIR);

    // Esperar un momento para que la sesión se inicie
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verificar que la sesión se creó correctamente
    const isRunning = await isScreenSessionAlive(screenName);
    if (!isRunning) {
      throw new Error("La sesión de screen no se pudo iniciar correctamente");
    }

    state[gameId] = {
      ...state[gameId],
      screenName: screenName,
      updatedAt: new Date().toISOString()
    };

    // Eliminar pid antiguo si existe
    delete state[gameId].pid;

    await writeState(state);

    log(`${gameId}: Servidor iniciado en screen session "${screenName}"`);
    return { ok: true, message: "Servidor iniciado.", screenName: screenName };
  } catch (error) {
    log(`${gameId}: Error al iniciar screen session: ${error.message}`);
    throw error;
  }
}

// Verificar si una sesión de screen está activa
async function isScreenSessionAlive(screenName) {
  try {
    await runCommand("screen", ["-list", screenName], BASE_DIR);
    return true;
  } catch (error) {
    return false;
  }
}

// Enviar comando a una sesión de screen
async function sendCommandToScreen(screenName, command) {
  // screen -S <name> -X stuff "command\n"
  await runCommand("screen", [
    "-S", screenName,
    "-X", "stuff",
    `${command}\n`
  ], BASE_DIR);
}

// Función especial para instalar Hytale usando el downloader oficial
async function installHytale(game, instancePath, log) {
  const downloaderZip = path.join(DOWNLOADS_DIR, game.downloadFileName);
  const downloaderBin = path.join(DOWNLOADS_DIR, game.downloaderBin);

  // 1. Descargar el hytale-downloader
  log(`hytale: Descargando hytale-downloader...`);
  await downloadFile(game.downloadUrl, downloaderZip);

  // 2. Extraer el downloader
  log(`hytale: Extrayendo downloader...`);
  await extractArchive(downloaderZip, DOWNLOADS_DIR);

  // 3. Dar permisos de ejecución
  await fs.chmod(downloaderBin, 0o755);

  // 4. Ejecutar el downloader (descarga el servidor)
  log(`hytale: Ejecutando downloader (esto puede tardar varios minutos)...`);
  log(`hytale: NOTA - Si es la primera vez, se requerirá autenticación OAuth2`);

  await new Promise((resolve, reject) => {
    const child = spawn(downloaderBin, [], {
      cwd: DOWNLOADS_DIR,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    let authCodeShown = false;

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;

      // Detectar código de autenticación específicamente para resaltar
      if (text.includes("Visit:") || text.includes("Enter code:")) {
        if (!authCodeShown) {
          log(`hytale: ⚠️  AUTENTICACIÓN REQUERIDA`);
          authCodeShown = true;
        }
      }

      // Mostrar todas las líneas en los logs
      const lines = text.split("\n").filter(l => l.trim());
      for (const line of lines) {
        log(`hytale: ${line.trim()}`);
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      output += text;
      const lines = text.split("\n").filter(l => l.trim());
      for (const line of lines) {
        log(`hytale ERROR: ${line.trim()}`);
      }
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Downloader falló con código ${code}. Output: ${output.slice(-500)}`));
      }
    });

    child.on("error", reject);
  });

  // 5. Buscar el archivo .zip descargado
  log(`hytale: Buscando archivo descargado...`);
  const files = await fs.readdir(DOWNLOADS_DIR);
  const serverZip = files.find(f => f.match(/^\d{4}\.\d{2}\.\d{2}-.+\.zip$/));

  if (!serverZip) {
    throw new Error("No se encontró el archivo del servidor descargado");
  }

  log(`hytale: Encontrado: ${serverZip}`);

  // 6. Extraer el servidor en el directorio de instancia
  log(`hytale: Extrayendo servidor...`);
  const serverZipPath = path.join(DOWNLOADS_DIR, serverZip);
  await extractArchive(serverZipPath, instancePath);

  // 7. Verificar que existen los archivos necesarios
  const serverJar = path.join(instancePath, "Server", "HytaleServer.jar");
  const assetsZip = path.join(instancePath, "Assets.zip");

  try {
    await fs.access(serverJar);
    await fs.access(assetsZip);
    log(`hytale: ✓ Archivos del servidor verificados`);
  } catch (error) {
    throw new Error("Archivos del servidor no encontrados. Estructura incorrecta.");
  }
}


async function installGame(gameId, log = () => { }) {
  const game = getGame(gameId);
  const instancePath = game.instanceDir;
  const downloadPath = path.join(DOWNLOADS_DIR, game.downloadFileName);

  log(`${gameId}: Verificando si ya existe...`);
  await fs.access(instancePath).then(
    () => {
      throw new Error(
        `La instancia de ${game.name} ya existe. Borra primero para reinstalar.`
      );
    },
    () => { }
  );

  log(`${gameId}: Creando directorio de instancia...`);
  await fs.mkdir(instancePath, { recursive: true });

  try {
    if (gameId === "hytale") {
      await installHytale(game, instancePath, log);
    } else {
      log(`${gameId}: Descargando desde ${game.downloadUrl}...`);
      await downloadFile(game.downloadUrl, downloadPath);
      log(`${gameId}: Descarga completada`);

      if (downloadPath.endsWith(".jar")) {
        log(`${gameId}: Copiando archivo JAR...`);
        await fs.copyFile(downloadPath, path.join(instancePath, "server.jar"));
      } else {
        log(`${gameId}: Extrayendo archivos...`);
        await extractArchive(downloadPath, instancePath);
      }
    }

    log(`${gameId}: Aplicando configuración post-instalación...`);
    for (const postFile of game.postInstallFiles) {
      await fs.writeFile(
        path.join(instancePath, postFile.file),
        postFile.content,
        "utf8"
      );
    }

    log(`${gameId}: ✓ Instalación completada`);
    return {
      ok: true,
      game: gameId,
      message: `Instalado correctamente: ${game.name}.`
    };
  } catch (error) {
    log(`${gameId}: ✗ Error durante instalación: ${error.message}`);
    await fs.rm(instancePath, { recursive: true, force: true });
    throw error;
  }
}

async function restartGame(gameId, log = () => { }) {
  getGame(gameId);
  log(`${gameId}: Reiniciando servidor...`);
  await stopGame(gameId, log);
  return startInstalledGame(gameId, log);
}

async function deleteGame(gameId, log = () => { }) {
  const game = getGame(gameId);
  log(`${gameId}: Eliminando instancia...`);
  await stopGame(gameId, log);

  log(`${gameId}: Eliminando archivos...`);
  await fs.rm(game.instanceDir, { recursive: true, force: true });

  const state = await readState();
  delete state[gameId];
  await writeState(state);

  log(`${gameId}: ✓ Instancia eliminada completamente`);
  return { ok: true, game: gameId, message: "Instancia eliminada por completo." };
}

async function status() {
  const state = await readState();
  const result = {};
  for (const [id, game] of Object.entries(GAMES)) {
    const screenName = state[id]?.screenName ?? null;
    const running = screenName ? await isScreenSessionAlive(screenName) : false;
    result[id] = {
      name: game.name,
      port: game.port,
      protocol: game.protocol,
      installed: await pathExists(game.instanceDir),
      running,
      screenName: running ? screenName : null,
      params: state[id]?.params || "" // Incluir parámetros guardados
    };
  }
  return result;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

// Guardar parámetros personalizados para un juego
async function saveParams(gameId, params) {
  getGame(gameId); // Validar que el juego existe
  const state = await readState();

  if (!state[gameId]) {
    state[gameId] = {};
  }

  state[gameId].params = params;
  await writeState(state);

  return { ok: true, message: "Parámetros guardados." };
}

// Guardar contraseña para un juego
async function savePassword(gameId, password) {
  const game = getGame(gameId);
  const instancePath = game.instanceDir;

  // Verificar que el juego está instalado
  if (!await pathExists(instancePath)) {
    throw new Error(`El juego ${gameId} no está instalado.`);
  }

  // Guardar contraseña según el tipo de juego
  if (gameId === "minecraft_java") {
    // Minecraft Java: modificar server.properties
    const propsPath = path.join(instancePath, "server.properties");
    let content = "";

    try {
      content = await fs.readFile(propsPath, "utf8");
    } catch (error) {
      // Si no existe, crear uno básico
      content = "";
    }

    // Actualizar o añadir la línea de contraseña
    const lines = content.split("\n");
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("server-password=")) {
        lines[i] = `server-password=${password}`;
        found = true;
        break;
      }
    }

    if (!found) {
      lines.push(`server-password=${password}`);
    }

    await fs.writeFile(propsPath, lines.join("\n"), "utf8");

  } else if (gameId === "minecraft_bedrock") {
    // Minecraft Bedrock: modificar server.properties
    const propsPath = path.join(instancePath, "server.properties");
    let content = "";

    try {
      content = await fs.readFile(propsPath, "utf8");
    } catch (error) {
      content = "";
    }

    const lines = content.split("\n");
    let found = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("server-password=")) {
        lines[i] = `server-password=${password}`;
        found = true;
        break;
      }
    }

    if (!found) {
      lines.push(`server-password=${password}`);
    }

    await fs.writeFile(propsPath, lines.join("\n"), "utf8");

  } else if (gameId === "hytale") {
    // Hytale: modificar config.json
    const configPath = path.join(instancePath, "config.json");

    try {
      const configContent = await fs.readFile(configPath, "utf8");
      const config = JSON.parse(configContent);
      config.Password = password;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    } catch (error) {
      throw new Error(`No se pudo actualizar la contraseña en config.json: ${error.message}`);
    }
  }

  return { ok: true, message: "Contraseña actualizada." };
}

async function getAIConfig() {
  const state = await readState();
  return state._ai || null;
}

async function saveAIConfig(config) {
  const state = await readState();
  state._ai = config;
  await writeState(state);
  return { ok: true, message: "Configuración AI guardada." };
}

async function getAISystemPrompt() {
  const state = await readState();
  return state._ai?.systemPrompt || null;
}

async function saveAISystemPrompt(prompt) {
  const state = await readState();
  if (!state._ai) state._ai = {};
  state._ai.systemPrompt = prompt;
  await writeState(state);
  return { ok: true, message: "Prompt del asistente guardado." };
}

async function getAIGamePrompt(gameId) {
  const state = await readState();
  return state._ai?.gamePrompts?.[gameId] || null;
}

async function saveAIGamePrompt(gameId, prompt) {
  const state = await readState();
  if (!state._ai) state._ai = {};
  if (!state._ai.gamePrompts) state._ai.gamePrompts = {};
  if (prompt) {
    state._ai.gamePrompts[gameId] = prompt;
  } else {
    delete state._ai.gamePrompts[gameId];
  }
  await writeState(state);
  return { ok: true, message: "Prompt de juego guardado." };
}

async function startLogStream(gameId, callback, lineCallback = null) {
  if (activeTailers.has(gameId)) return;

  const game = getGame(gameId);
  const logFile = path.join(game.instanceDir, "screen.log");

  // Asegurar que el archivo existe
  try {
    await fs.access(logFile);
  } catch (_e) {
    await fs.writeFile(logFile, "", "utf8");
  }

  const tail = spawn("tail", ["-n", "0", "-f", logFile]);
  activeTailers.set(gameId, tail);

  tail.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        callback(`${gameId}|LOG: ${line.trim()}`);
        if (lineCallback) lineCallback(gameId, line.trim());
      }
    }
  });

  tail.on("exit", () => {
    activeTailers.delete(gameId);
  });

  tail.on("error", (err) => {
    console.error(`Error en tail para ${gameId}:`, err.message);
    activeTailers.delete(gameId);
  });
}

function stopLogStream(gameId) {
  const tail = activeTailers.get(gameId);
  if (tail) {
    tail.kill();
    activeTailers.delete(gameId);
  }
}

module.exports = {
  ensureRuntimeContext,
  installGame,
  startInstalledGame,
  stopGame,
  restartGame,
  deleteGame,
  status,
  saveParams,
  savePassword,
  sendCommandToScreen,
  startLogStream,
  stopLogStream,
  getAIConfig,
  saveAIConfig,
  getAISystemPrompt,
  saveAISystemPrompt,
  getAIGamePrompt,
  saveAIGamePrompt
};
