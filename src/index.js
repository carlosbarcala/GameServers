const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");
const {
  ensureRuntimeContext,
  installGame,
  restartGame,
  deleteGame,
  status
} = require("./serverManager");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const AUTH_REALM = "Game Servers Manager";
const ALLOWED_USERS = new Set(["wnzero", "barcalator"]);
const ACCESS_PASSWORD = "barcosyfrutas";

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
      if (net.family === "IPv4" && !net.internal) {
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

async function handleRequest(req, res) {
  if (!isAuthorized(req)) {
    return sendUnauthorized(res);
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
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
        const result = await installGame(gameId);
        return sendJson(res, 200, result);
      }

      if (req.method === "DELETE") {
        const result = await deleteGame(gameId);
        return sendJson(res, 200, result);
      }
    }

    if (parts.length === 3 && parts[0] === "games" && parts[2] === "restart") {
      if (req.method === "POST") {
        const gameId = normalizeGameId(parts[1]);
        const result = await restartGame(gameId);
        return sendJson(res, 200, result);
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
    return sendJson(res, 400, {
      ok: false,
      error: error.message
    });
  }
}

async function bootstrap() {
  await ensureRuntimeContext();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message });
    });
  });

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Game Servers Manager escuchando en http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
