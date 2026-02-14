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

async function ensureRuntimeContext() {
  const username = os.userInfo().username;
  const cwd = process.cwd();

  if (username !== "games") {
    throw new Error('Este proceso debe ejecutarse con el usuario "games".');
  }

  if (!cwd.startsWith(`${BASE_DIR}/`) && cwd !== BASE_DIR) {
    throw new Error(`Este proceso debe ejecutarse desde ${BASE_DIR}/`);
  }

  await fs.mkdir(INSTANCES_DIR, { recursive: true });
  await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
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

async function stopGame(gameId) {
  const state = await readState();
  const entry = state[gameId];

  if (!entry?.pid || !isProcessAlive(entry.pid)) {
    return { ok: true, message: "No había proceso activo." };
  }

  process.kill(entry.pid, "SIGTERM");

  let retries = 10;
  while (retries > 0 && isProcessAlive(entry.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    retries -= 1;
  }

  if (isProcessAlive(entry.pid)) {
    process.kill(entry.pid, "SIGKILL");
  }

  delete state[gameId];
  await writeState(state);
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

async function startInstalledGame(gameId) {
  const game = getGame(gameId);
  const instancePath = game.instanceDir;
  const state = await readState();

  if (state[gameId]?.pid && isProcessAlive(state[gameId].pid)) {
    return { ok: true, message: "Ya estaba ejecutándose.", pid: state[gameId].pid };
  }

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

  return { ok: true, message: "Servidor iniciado.", pid: child.pid };
}

async function installGame(gameId) {
  const game = getGame(gameId);
  const instancePath = game.instanceDir;
  const downloadPath = path.join(DOWNLOADS_DIR, game.downloadFileName);

  await fs.access(instancePath).then(
    () => {
      throw new Error(
        `La instancia de ${game.name} ya existe. Borra primero para reinstalar.`
      );
    },
    () => {}
  );

  await fs.mkdir(instancePath, { recursive: true });

  try {
    await downloadFile(game.downloadUrl, downloadPath);

    if (downloadPath.endsWith(".jar")) {
      await fs.copyFile(downloadPath, path.join(instancePath, "server.jar"));
    } else {
      await extractArchive(downloadPath, instancePath);
    }

    for (const postFile of game.postInstallFiles) {
      await fs.writeFile(
        path.join(instancePath, postFile.file),
        postFile.content,
        "utf8"
      );
    }

    const startResult = await startInstalledGame(gameId);
    return {
      ok: true,
      game: gameId,
      message: `Instalado e iniciado: ${game.name}.`,
      pid: startResult.pid
    };
  } catch (error) {
    await fs.rm(instancePath, { recursive: true, force: true });
    throw error;
  }
}

async function restartGame(gameId) {
  getGame(gameId);
  await stopGame(gameId);
  return startInstalledGame(gameId);
}

async function deleteGame(gameId) {
  const game = getGame(gameId);
  await stopGame(gameId);
  await fs.rm(game.instanceDir, { recursive: true, force: true });

  const state = await readState();
  delete state[gameId];
  await writeState(state);

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
  restartGame,
  deleteGame,
  status
};
