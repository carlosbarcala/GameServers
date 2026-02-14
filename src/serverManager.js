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

  if (!entry?.pid || !isProcessAlive(entry.pid)) {
    log(`${gameId}: No había proceso activo`);
    return { ok: true, message: "No había proceso activo." };
  }

  log(`${gameId}: Deteniendo proceso (PID ${entry.pid})...`);
  process.kill(entry.pid, "SIGTERM");

  let retries = 10;
  while (retries > 0 && isProcessAlive(entry.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    retries -= 1;
  }

  if (isProcessAlive(entry.pid)) {
    log(`${gameId}: Forzando detención (SIGKILL)`);
    process.kill(entry.pid, "SIGKILL");
  }

  delete state[gameId];
  await writeState(state);
  log(`${gameId}: Proceso detenido correctamente`);
  return { ok: true, message: "Proceso detenido." };
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
    const child = spawn(bin, args, { cwd, stdio: "ignore" });
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

  if (state[gameId]?.pid && isProcessAlive(state[gameId].pid)) {
    log(`${gameId}: Ya estaba ejecutándose (PID ${state[gameId].pid})`);
    return { ok: true, message: "Ya estaba ejecutándose.", pid: state[gameId].pid };
  }

  log(`${gameId}: Iniciando servidor...`);
  const outLog = fsSync.openSync(path.join(instancePath, "stdout.log"), "a");
  const errLog = fsSync.openSync(path.join(instancePath, "stderr.log"), "a");

  const child = spawn(game.launchCommand.bin, game.launchCommand.args, {
    cwd: instancePath,
    detached: true,
    stdio: ["ignore", outLog, errLog]
  });

  child.unref();

  state[gameId] = {
    pid: child.pid,
    updatedAt: new Date().toISOString()
  };
  await writeState(state);

  log(`${gameId}: Servidor iniciado con PID ${child.pid}`);
  return { ok: true, message: "Servidor iniciado.", pid: child.pid };
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

      // Detectar código de autenticación
      if (text.includes("Visit:") || text.includes("Enter code:")) {
        if (!authCodeShown) {
          log(`hytale: ⚠️  AUTENTICACIÓN REQUERIDA`);
          authCodeShown = true;
        }
      }

      // Mostrar líneas importantes en los logs
      const lines = text.split("\n").filter(l => l.trim());
      for (const line of lines) {
        if (line.includes("Visit:") || line.includes("Enter code:") ||
          line.includes("https://") || line.includes("Authentication") ||
          line.includes("Download")) {
          log(`hytale: ${line.trim()}`);
        }
      }
    });

    child.stderr.on("data", (data) => {
      output += data.toString();
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

    log(`${gameId}: Aplicando configuración post-instalación...`);
    for (const postFile of game.postInstallFiles) {
      await fs.writeFile(
        path.join(instancePath, postFile.file),
        postFile.content,
        "utf8"
      );
    }

    const startResult = await startInstalledGame(gameId, log);
    log(`${gameId}: ✓ Instalación completada`);
    return {
      ok: true,
      game: gameId,
      message: `Instalado e iniciado: ${game.name}.`,
      pid: startResult.pid
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
    const pid = state[id]?.pid ?? null;
    const running = pid ? isProcessAlive(pid) : false;
    result[id] = {
      name: game.name,
      port: game.port,
      protocol: game.protocol,
      installed: await pathExists(game.instanceDir),
      running,
      pid: running ? pid : null
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

module.exports = {
  ensureRuntimeContext,
  installGame,
  startInstalledGame,
  stopGame,
  restartGame,
  deleteGame,
  status
};
