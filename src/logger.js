const fs = require("node:fs/promises");
const { LOG_FILE } = require("./config");

async function log(message) {
    const ts = new Date().toISOString();
    const formatted = `[${ts}] ${message}`;

    // Imprimir en consola para systemd (journalctl)
    console.log(formatted);

    // Guardar en archivo app.log
    try {
        await fs.appendFile(LOG_FILE, formatted + "\n", "utf8");
    } catch (error) {
        console.error(`[ERROR LOGGING] No se pudo escribir en ${LOG_FILE}: ${error.message}`);
    }
}

async function logError(message, error) {
    const errorMsg = error ? `${message}: ${error.stack || error.message}` : message;
    await log(`ERROR - ${errorMsg}`);
}

module.exports = {
    log,
    logError
};
