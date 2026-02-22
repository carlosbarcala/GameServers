const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");
const {
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
  getAIConfig,
  saveAIConfig,
  getAISystemPrompt,
  saveAISystemPrompt,
  getAIGamePrompt,
  saveAIGamePrompt,
  getAIAgentPrompt,
  saveAIAgentPrompt
} = require("./serverManager");
const { log, logError } = require("./logger");
const chatAssistant = require("./services/ai/ChatAssistant");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const AUTH_REALM = "Game Servers Manager";
const ALLOWED_USERS = new Set(["zerownz", "barcalator"]);
const ACCESS_PASSWORD = "barcosyfrutas";

// Carga variables del archivo .env sin dependencias externas.
// Las variables del .env siempre sobreescriben las del entorno del proceso.
async function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  try {
    const content = await fs.readFile(envPath, "utf8");
    let loaded = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key) {
        process.env[key] = value;
        loaded++;
      }
    }
    console.log(`[ENV] .env cargado desde ${envPath} (${loaded} variables)`);
  } catch (err) {
    console.log(`[ENV] Sin archivo .env (${envPath}): ${err.message}`);
  }
}

// Función que envía un mensaje al chat del juego (God o Agent)
function buildSendChatFn() {
  return async (gameId, message, prefix = 'God') => {
    const gameStatus = await status();
    const screenName = gameStatus[gameId]?.screenName;
    if (!screenName) return;
    const cmd = gameId === "hytale"
      ? `broadcast [${prefix}] ${message}`
      : `say [${prefix}] ${message}`;
    await sendCommandToScreen(screenName, cmd);
    broadcast(`${gameId} [${prefix}]: ${message}`);
  };
}

// Configura el asistente de chat con la config almacenada o las vars de entorno.
// Las variables de .env siempre sobreescriben los campos del estado guardado.
async function initChatAssistant() {
  const aiConfig = await getAIConfig() || {};

  // .env tiene prioridad: sobreescribe campo a campo lo que esté definido
  if (process.env.AI_PROVIDER)  aiConfig.provider = process.env.AI_PROVIDER;
  if (process.env.AI_API_KEY)   aiConfig.apiKey   = process.env.AI_API_KEY;
  if (process.env.AI_MODEL)     aiConfig.model    = process.env.AI_MODEL;
  if (process.env.AI_BASE_URL)  aiConfig.baseUrl  = process.env.AI_BASE_URL;

  if (!aiConfig.provider || !aiConfig.apiKey) {
    log("AI: Asistente desactivado (sin configuración de API)");
    return;
  }

  await saveAIConfig(aiConfig);
  log(`AI: Configuración — proveedor: ${aiConfig.provider}, modelo: ${aiConfig.model ?? "default"}${aiConfig.baseUrl ? `, url: ${aiConfig.baseUrl}` : ""}`);

  chatAssistant.configure(aiConfig);
  chatAssistant.logFn = broadcast;
  chatAssistant.sendChatFn = buildSendChatFn();

  // Cargar prompt general personalizado si existe
  const savedPrompt = await getAISystemPrompt();
  if (savedPrompt) chatAssistant.setSystemPrompt(savedPrompt);

  // Cargar prompts específicos por juego (God)
  for (const gameId of ['minecraft', 'hytale']) {
    const gamePrompt = await getAIGamePrompt(gameId);
    if (gamePrompt) chatAssistant.setGamePrompt(gameId, gamePrompt);
  }

  // Cargar prompt del agente
  const savedAgentPrompt = await getAIAgentPrompt();
  if (savedAgentPrompt) chatAssistant.setAgentPrompt(savedAgentPrompt);

  log(`AI: Asistente "God" activo (${chatAssistant.provider})`);
}

let wss = null;
const wsClients = new Set();

function broadcast(message) {
  const payload = JSON.stringify({
    type: "log",
    timestamp: new Date().toISOString(),
    message
  });

  for (const client of wsClients) {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  }

  // También log en consola del servidor
  console.log(`[LOG] ${message}`);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function normalizeGameId(raw) {
  return raw?.trim().toLowerCase();
}

function getServerIps() {
  const nets = os.networkInterfaces();
  const ips = [];

  for (const networkEntries of Object.values(nets)) {
    if (!networkEntries) continue;
    for (const net of networkEntries) {
      // Solo IPv4, no internas, no localhost
      if (net.family === "IPv4" && !net.internal && net.address !== "127.0.0.1") {
        ips.push(net.address);
      }
    }
  }

  return Array.from(new Set(ips));
}

function parseBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return null;
  }

  const encoded = authHeader.slice("Basic ".length).trim();
  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch (_error) {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return null;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

function isAuthorized(req) {
  const credentials = parseBasicAuth(req.headers.authorization);
  if (!credentials) {
    return false;
  }
  return (
    ALLOWED_USERS.has(credentials.username) &&
    credentials.password === ACCESS_PASSWORD
  );
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(
    JSON.stringify(
      {
        ok: false,
        error: "Autenticación requerida."
      },
      null,
      2
    )
  );
}

async function serveStaticFile(urlPath, res) {
  const staticPath = urlPath === "/" ? "/index.html" : urlPath;
  const absolutePath = path.normalize(path.join(PUBLIC_DIR, staticPath));

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    return false;
  }

  try {
    const data = await fs.readFile(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Leer body JSON de una petición
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  // Logging de la petición
  log(`${req.method} ${url.pathname} - IP: ${req.socket.remoteAddress}`);

  try {
    if (!isAuthorized(req)) {
      return sendUnauthorized(res);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/games") {
      return sendJson(res, 200, { ok: true, data: await status() });
    }

    if (req.method === "GET" && url.pathname === "/server-info") {
      return sendJson(res, 200, {
        ok: true,
        data: {
          ips: getServerIps(),
          port: PORT
        }
      });
    }

    if (parts.length === 2 && parts[0] === "games") {
      const gameId = normalizeGameId(parts[1]);

      if (req.method === "POST") {
        const result = await installGame(gameId, broadcast);
        return sendJson(res, 200, result);
      }

      if (req.method === "DELETE") {
        const result = await deleteGame(gameId, broadcast);
        return sendJson(res, 200, result);
      }
    }

    // ── Endpoints de configuración del asistente AI ──────────────────────
    if (parts.length === 1 && parts[0] === "ai") {
      if (req.method === "GET") {
        const aiConfig = await getAIConfig();
        return sendJson(res, 200, {
          ok: true,
          data: {
            provider: aiConfig?.provider || null,
            model: aiConfig?.model || null,
            baseUrl: aiConfig?.baseUrl || null,
            hasApiKey: !!aiConfig?.apiKey,
            enabled: chatAssistant.isEnabled()
          }
        });
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.provider || !body.apiKey) {
          return sendJson(res, 400, { ok: false, error: "Se requieren provider y apiKey." });
        }
        const aiConfig = {
          provider: body.provider,
          apiKey: body.apiKey,
          ...(body.model   ? { model:   body.model   } : {}),
          ...(body.baseUrl ? { baseUrl: body.baseUrl } : {})
        };
        await saveAIConfig(aiConfig);
        chatAssistant.configure(aiConfig);
        chatAssistant.logFn = broadcast;
        chatAssistant.sendChatFn = buildSendChatFn();
        log(`AI: Asistente reconfigurado — proveedor: "${body.provider}", modelo: "${body.model ?? "default"}"${body.baseUrl ? `, url: ${body.baseUrl}` : ""}`);
        return sendJson(res, 200, {
          ok: true,
          message: `Asistente AI configurado con ${body.provider}.`,
          enabled: chatAssistant.isEnabled()
        });
      }
    }

    // ── Endpoints de prompt del asistente AI ─────────────────────────────
    if (parts.length === 2 && parts[0] === "ai" && parts[1] === "prompt") {
      if (req.method === "GET") {
        const savedPrompt = await getAISystemPrompt();
        return sendJson(res, 200, {
          ok: true,
          data: {
            prompt: savedPrompt || chatAssistant.getDefaultSystemPrompt(),
            isDefault: !savedPrompt
          }
        });
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const prompt = body.prompt?.trim() || "";
        if (prompt) {
          await saveAISystemPrompt(prompt);
          chatAssistant.setSystemPrompt(prompt);
          log("AI: Prompt del asistente actualizado");
        } else {
          await saveAISystemPrompt(null);
          chatAssistant.setSystemPrompt(null);
          log("AI: Prompt del asistente restaurado al default");
        }
        return sendJson(res, 200, { ok: true, message: "Prompt actualizado." });
      }
    }

    // ── Endpoints de prompt específico por juego ──────────────────────────
    if (parts.length === 3 && parts[0] === "ai" && parts[1] === "prompt") {
      const gameKey = normalizeGameId(parts[2]); // 'minecraft' | 'hytale'

      if (req.method === "GET") {
        const gamePrompt = await getAIGamePrompt(gameKey);
        return sendJson(res, 200, {
          ok: true,
          data: { prompt: gamePrompt || "", isDefault: !gamePrompt }
        });
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const prompt = body.prompt?.trim() || "";
        await saveAIGamePrompt(gameKey, prompt || null);
        chatAssistant.setGamePrompt(gameKey, prompt || null);
        log(`AI: Prompt de ${gameKey} ${prompt ? "actualizado" : "restaurado al general"}`);
        return sendJson(res, 200, { ok: true, message: "Prompt actualizado." });
      }
    }

    // ── Endpoint de prompt del agente ─────────────────────────────────────
    if (parts.length === 2 && parts[0] === "ai" && parts[1] === "agent-prompt") {
      if (req.method === "GET") {
        const savedAgentPrompt = await getAIAgentPrompt();
        return sendJson(res, 200, {
          ok: true,
          data: {
            prompt: savedAgentPrompt || chatAssistant.getDefaultAgentPrompt(),
            isDefault: !savedAgentPrompt
          }
        });
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const prompt = body.prompt?.trim() || "";
        await saveAIAgentPrompt(prompt || null);
        chatAssistant.setAgentPrompt(prompt || null);
        log(`AI: Prompt del agente ${prompt ? "actualizado" : "restaurado al default"}`);
        return sendJson(res, 200, { ok: true, message: "Prompt del agente actualizado." });
      }
    }

    if (parts.length === 3 && parts[0] === "games") {
      const gameId = normalizeGameId(parts[1]);

      if (parts[2] === "restart" && req.method === "POST") {
        chatAssistant.deactivateServer(gameId);
        const result = await restartGame(gameId, broadcast);
        startLogStream(gameId, broadcast, (gid, line) => chatAssistant.processLine(gid, line))
          .catch(err => logError(`Error log stream: ${err.message}`));
        chatAssistant.activateServer(gameId);
        return sendJson(res, 200, result);
      }

      if (parts[2] === "start" && req.method === "POST") {
        const result = await startInstalledGame(gameId, broadcast);
        startLogStream(gameId, broadcast, (gid, line) => chatAssistant.processLine(gid, line))
          .catch(err => logError(`Error log stream: ${err.message}`));
        chatAssistant.activateServer(gameId);
        return sendJson(res, 200, result);
      }

      if (parts[2] === "stop" && req.method === "POST") {
        chatAssistant.deactivateServer(gameId);
        const result = await stopGame(gameId, broadcast);
        return sendJson(res, 200, result);
      }

      if (parts[2] === "params" && req.method === "POST") {
        const body = await readJsonBody(req);
        const result = await saveParams(gameId, body.params || "");
        return sendJson(res, 200, result);
      }

      if (parts[2] === "password" && req.method === "POST") {
        const body = await readJsonBody(req);
        const result = await savePassword(gameId, body.password || "");
        broadcast(`${gameId}: contraseña actualizada`);
        return sendJson(res, 200, result);
      }

      if (parts[2] === "command" && req.method === "POST") {
        const body = await readJsonBody(req);
        const gameStatus = await status();
        const screenName = gameStatus[gameId]?.screenName;

        if (!screenName) {
          throw new Error("El servidor no está en ejecución.");
        }

        await sendCommandToScreen(screenName, body.command);
        broadcast(`${gameId}: comando enviado -> ${body.command}`);
        return sendJson(res, 200, { ok: true, message: "Comando enviado." });
      }

      if (parts[2] === "chat" && req.method === "POST") {
        const body = await readJsonBody(req);
        const gameStatus = await status();
        const screenName = gameStatus[gameId]?.screenName;

        if (!screenName) {
          throw new Error("El servidor no está en ejecución.");
        }

        let cmd = "";
        if (gameId === "hytale") {
          cmd = `broadcast ${body.message}`;
        } else {
          cmd = `say ${body.message}`;
        }

        await sendCommandToScreen(screenName, cmd);
        broadcast(`${gameId} [CHAT]: ${body.message}`);
        return sendJson(res, 200, { ok: true, message: "Mensaje enviado." });
      }
    }

    if (req.method === "GET") {
      const served = await serveStaticFile(url.pathname, res);
      if (served) {
        return;
      }
    }

    return sendJson(res, 404, {
      ok: false,
      error: "Ruta no encontrada."
    });
  } catch (error) {
    logError(`Error procesando ${req.method} ${url.pathname}`, error);
    return sendJson(res, 400, {
      ok: false,
      error: error.message
    });
  }
}

async function bootstrap() {
  await loadEnv();
  await ensureRuntimeContext();
  await initChatAssistant();

  // Iniciar log streaming y vigilancia God para juegos que ya estén corriendo
  const currentStatus = await status();
  for (const [gameId, info] of Object.entries(currentStatus)) {
    if (info.running) {
      startLogStream(gameId, broadcast, (gid, line) => chatAssistant.processLine(gid, line))
        .catch(err => {
          logError(`Error iniciando log stream para ${gameId} en bootstrap`, err);
        });
      chatAssistant.activateServer(gameId);
    }
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message });
    });
  });

  // Configurar WebSocket server
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log("[WS] Cliente conectado. Total:", wsClients.size);

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log("[WS] Cliente desconectado. Total:", wsClients.size);
    });

    ws.on("error", (error) => {
      console.error("[WS] Error:", error.message);
      wsClients.delete(ws);
    });
  });

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Game Servers Manager escuchando en http://0.0.0.0:${PORT}`);
    console.log(`WebSocket server activo en ws://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
