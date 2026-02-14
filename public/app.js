const GAME_IDS = ["minecraft_java", "minecraft_bedrock", "hytale"];

const cardsEl = document.querySelector("#cards");
const healthBadgeEl = document.querySelector("#healthBadge");
const logBoxEl = document.querySelector("#logBox");
const refreshBtnEl = document.querySelector("#refreshBtn");
const template = document.querySelector("#gameCardTemplate");

let isBusy = false;

function pushLog(message) {
  const ts = new Date().toLocaleTimeString();
  logBoxEl.textContent = `[${ts}] ${message}\n${logBoxEl.textContent}`.slice(0, 6000);
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
  return `${gameId} | ${installText} | ${pidText}`;
}

function renderCards(data) {
  cardsEl.innerHTML = "";
  for (const gameId of GAME_IDS) {
    const game = data[gameId];
    if (!game) continue;

    const node = template.content.cloneNode(true);
    const article = node.querySelector(".card");
    const nameEl = node.querySelector(".game-name");
    const pill = node.querySelector(".status-pill");
    const meta = node.querySelector(".meta");
    const actionButtons = node.querySelectorAll("button[data-action]");

    nameEl.textContent = game.name;
    pill.textContent = statusText(game);
    pill.classList.add(statusClass(game));
    meta.textContent = buildMeta(game, gameId);

    for (const button of actionButtons) {
      const action = button.dataset.action;
      button.addEventListener("click", () => runAction(gameId, action));
      if (action === "install" && game.installed) {
        button.disabled = true;
      }
      if (action === "restart" && !game.installed) {
        button.disabled = true;
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
      pushLog(`${gameId}: instalación iniciada y servidor arrancado`);
    } else if (action === "restart") {
      await request(`/games/${gameId}/restart`, "POST");
      pushLog(`${gameId}: reiniciado`);
    } else if (action === "delete") {
      const confirmDelete = window.confirm(
        `Se eliminará por completo la instancia de ${gameId}. ¿Continuar?`
      );
      if (!confirmDelete) {
        setBusy(false);
        return;
      }
      await request(`/games/${gameId}`, "DELETE");
      pushLog(`${gameId}: instancia eliminada`);
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
