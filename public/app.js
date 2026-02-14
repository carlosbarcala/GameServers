const GAME_IDS = ["minecraft_java", "minecraft_bedrock", "hytale"];

const cardsEl = document.querySelector("#cards");
const healthBadgeEl = document.querySelector("#healthBadge");
const serverIpEl = document.querySelector("#serverIp");
const logBoxEl = document.querySelector("#logBox");
const refreshBtnEl = document.querySelector("#refreshBtn");
const wsStatusEl = document.querySelector("#wsStatus");
const template = document.querySelector("#gameCardTemplate");

let isBusy = false;
let ws = null;

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    wsStatusEl.textContent = "WebSocket conectado";
    wsStatusEl.classList.add("connected");
    pushLog("🔌 Conectado al servidor WebSocket");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "log") {
        pushLog(data.message);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    wsStatusEl.textContent = "WebSocket error";
    wsStatusEl.classList.remove("connected");
  };

  ws.onclose = () => {
    wsStatusEl.textContent = "WebSocket desconectado";
    wsStatusEl.classList.remove("connected");
    pushLog("🔌 Desconectado del servidor WebSocket");

    // Reconectar después de 3 segundos
    setTimeout(connectWebSocket, 3000);
  };
}

function pushLog(message) {
  const ts = new Date().toLocaleTimeString();
  logBoxEl.textContent += `[${ts}] ${message}\n`;

  // Limitar a ~6000 caracteres (eliminar líneas antiguas del inicio)
  if (logBoxEl.textContent.length > 6000) {
    const lines = logBoxEl.textContent.split("\n");
    logBoxEl.textContent = lines.slice(-100).join("\n");
  }

  // Auto-scroll al final
  logBoxEl.scrollTop = logBoxEl.scrollHeight;
}

function setBusy(value) {
  isBusy = value;
  const buttons = document.querySelectorAll(".btn[data-action], #refreshBtn");
  for (const button of buttons) {
    button.disabled = value;
  }
}

async function request(url, method = "GET") {
  const response = await fetch(url, { method });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Error inesperado");
  }
  return data;
}

async function checkHealth() {
  try {
    await request("/health");
    healthBadgeEl.textContent = "API activa";
  } catch (_error) {
    healthBadgeEl.textContent = "API sin respuesta";
  }
}

async function loadServerIp() {
  try {
    const payload = await request("/server-info");
    const ips = payload.data?.ips ?? [];
    if (ips.length === 0) {
      serverIpEl.textContent = "IP: no detectada";
      return;
    }
    // Mostrar solo la primera IPv4
    serverIpEl.textContent = `IP: ${ips[0]}`;
  } catch (_error) {
    serverIpEl.textContent = "IP: no disponible";
  }
}

function statusClass(game) {
  if (!game.installed) return "is-missing";
  if (game.running) return "is-running";
  return "is-stopped";
}

function statusText(game) {
  if (!game.installed) return "NO INSTALADO";
  if (game.running) return "ACTIVO";
  return "INSTALADO";
}

function buildMeta(game, gameId) {
  const pidText = game.pid ? `PID ${game.pid}` : "PID -";
  const installText = game.installed ? "instancia presente" : "sin instancia";
  const portInfo = game.port ? `Puerto ${game.port}/${game.protocol || "TCP"}` : "";
  return `${gameId} | ${installText} | ${pidText}${portInfo ? " | " + portInfo : ""}`;
}

function getGameLogo(gameId) {
  if (gameId === "minecraft_java" || gameId === "minecraft_bedrock") {
    return "/logo-mc.svg";
  }
  if (gameId === "hytale") {
    return "/logo-h.png";
  }
  return null;
}

function renderCards(data) {
  cardsEl.innerHTML = "";
  for (const gameId of GAME_IDS) {
    const game = data[gameId];
    if (!game) continue;

    const node = template.content.cloneNode(true);
    const article = node.querySelector(".card");
    const logoEl = node.querySelector(".game-logo");
    const nameEl = node.querySelector(".game-name");
    const pill = node.querySelector(".status-pill");
    const meta = node.querySelector(".meta");
    const actionButtons = node.querySelectorAll("button[data-action]");

    const logoSrc = getGameLogo(gameId);
    if (logoSrc) {
      logoEl.src = logoSrc;
      logoEl.alt = game.name;
    }

    nameEl.textContent = game.name;
    pill.textContent = statusText(game);
    pill.classList.add(statusClass(game));
    meta.textContent = buildMeta(game, gameId);

    for (const button of actionButtons) {
      const action = button.dataset.action;
      button.addEventListener("click", () => runAction(gameId, action));

      // Lógica de visibilidad de botones
      let shouldShow = false;

      if (!game.installed) {
        // NO INSTALADO: solo mostrar "Instalar"
        shouldShow = action === "install";
      } else if (game.running) {
        // ACTIVO: mostrar "Parar", "Reiniciar", "Eliminar"
        shouldShow = action === "stop" || action === "restart" || action === "delete";
      } else {
        // INSTALADO (parado): mostrar "Iniciar", "Eliminar"
        shouldShow = action === "start" || action === "delete";
      }

      if (!shouldShow) {
        button.style.display = "none";
      }
    }

    article.dataset.gameId = gameId;
    cardsEl.append(node);
  }
}

async function refreshStatus() {
  const payload = await request("/games");
  renderCards(payload.data);
}

async function runAction(gameId, action) {
  if (isBusy) return;
  setBusy(true);
  try {
    if (action === "install") {
      await request(`/games/${gameId}`, "POST");
      pushLog(`${gameId}: instalación iniciada`);
    } else if (action === "start") {
      await request(`/games/${gameId}/start`, "POST");
      pushLog(`${gameId}: inicio solicitado`);
    } else if (action === "stop") {
      await request(`/games/${gameId}/stop`, "POST");
      pushLog(`${gameId}: detención solicitada`);
    } else if (action === "restart") {
      await request(`/games/${gameId}/restart`, "POST");
      pushLog(`${gameId}: reinicio solicitado`);
    } else if (action === "delete") {
      const confirmDelete = window.confirm(
        `Se eliminará por completo la instancia de ${gameId}. ¿Continuar?`
      );
      if (!confirmDelete) {
        setBusy(false);
        return;
      }
      await request(`/games/${gameId}`, "DELETE");
      pushLog(`${gameId}: eliminación solicitada`);
    }
    await refreshStatus();
  } catch (error) {
    pushLog(`${gameId}: ERROR -> ${error.message}`);
    window.alert(error.message);
  } finally {
    setBusy(false);
  }
}

refreshBtnEl.addEventListener("click", async () => {
  if (isBusy) return;
  setBusy(true);
  try {
    await refreshStatus();
    pushLog("estado actualizado");
  } catch (error) {
    pushLog(`ERROR actualizando estado -> ${error.message}`);
  } finally {
    setBusy(false);
  }
});

async function init() {
  setBusy(true);
  await checkHealth();
  await loadServerIp();
  connectWebSocket();
  try {
    await refreshStatus();
    pushLog("panel listo");
  } catch (error) {
    pushLog(`No se pudo cargar el estado inicial: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

init();
