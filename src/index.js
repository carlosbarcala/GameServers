const http = require("node:http");
const { URL } = require("node:url");
const {
  ensureRuntimeContext,
  installGame,
  restartGame,
  deleteGame,
  status
} = require("./serverManager");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function normalizeGameId(raw) {
  return raw?.trim().toLowerCase();
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/games") {
      return sendJson(res, 200, { ok: true, data: await status() });
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
