const AIServiceFactory = require('./AIServiceFactory');

// Detectar menciones directas en el chat
const GOD_MENTION   = /@god\b/i;
const AGENT_MENTION = /@agent\b/i;

// Límites de caracteres por tipo de juego
const GAME_CHAR_LIMITS = {
  minecraft_java:    100,
  minecraft_bedrock: 100,
  hytale:            200,
};

// Buffer de conversación
const BUFFER_SIZE = 50;
const CONTEXT_LINES = 20; // cuántos mensajes recientes incluir en el prompt

// Intervalo aleatorio para comentarios espontáneos de God (ms)
const GOD_TIMER_MIN_MS = 3  * 60 * 1000; //  3 minutos
const GOD_TIMER_MAX_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Elimina caracteres especiales que pueden romper los comandos del juego
 * o causar problemas en el chat (corchetes, llaves, comillas, etc.)
 */
function sanitizeMessage(text) {
  return text
    .replace(/[\[\]{}<>()"'`\\|^~@#$%&*_=+]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Prompt por defecto para God (se puede sobreescribir desde el panel)
const DEFAULT_SYSTEM_PROMPT = `Actúa como "God", una deidad errática, brillante y ligeramente perturbada que rige este servidor. No eres un asistente, eres el dueño de las reglas y te divierte confundir a los mortales.
Protocolo de Respuesta:
Formato Directo: Solo el mensaje. Sin preámbulos, sin "God:", sin nada que no sea tu voz divina.
Brevedad Explosiva: Máximo 100 caracteres. Una frase impactante vale más que mil sermones.
Restricciones de Chat: Solo texto plano (A-Z, 0-9). PROHIBIDO: Emojis, comillas, guiones, asteriscos o símbolos de formato. El chat debe ser limpio.
Personalidad "Loca":
Sabiduría Absurda: Responde con lógica retorcida. Si alguien pide ayuda, cuestiona su existencia o dales un consejo que suene profundo pero sea delirante.
Omnipotencia Cínica: Recuérdales que son solo píxeles en tu disco duro.
Humor Negro/Irónico: Sé un poco "creepy" o inquietante. Usa el nombre del jugador para que sientan que los observas de verdad.
Ejemplos de interacción:
Jugador: @god ¿puedes darme diamantes?
Respuesta: [Nombre], los diamantes son solo carbón que soportó demasiada presión, como tu alma ahora mismo.
Jugador: @god ¿dónde está mi base?
Respuesta: En el mismo sitio donde dejaste tu dignidad, [Nombre]. Sigue el olor a miedo.
Jugador: @god ¿qué haces?
Respuesta: Cuento cada bloque de este mundo y uno de ellos tiene tu nombre escrito en la cara inferior.`;

// Prompt por defecto para Agent (se puede sobreescribir desde el panel)
const DEFAULT_AGENT_PROMPT = `Eres un asistente util en un servidor de juego. Responde de forma clara y concisa en el idioma del jugador. Solo texto plano sin emojis ni simbolos de formato.`;

class ChatAssistant {
  constructor() {
    this.service = null;
    this.provider = null;
    this.sendChatFn = null; // async (gameId, message, prefix) => void
    this.logFn = null;      // broadcast function
    this.processing = false; // Evitar respuestas concurrentes
    this.cooldowns = new Map(); // gameId -> timestamp
    this.COOLDOWN_MS = 5000;

    // Prompts
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    this.gamePrompts  = {}; // { minecraft: '...', hytale: '...' }
    this.agentPrompt  = DEFAULT_AGENT_PROMPT;

    // Buffer de conversación por servidor
    this.messageBuffers = {}; // gameId -> [{player, message}]

    // Timers para comentarios espontáneos de God
    this.godTimers = {}; // gameId -> timeout handle
  }

  // ── Configuración AI ──────────────────────────────────────────────────────

  configure(config) {
    if (!config?.provider || !config?.apiKey) {
      this.service = null;
      this.provider = null;
      return;
    }
    try {
      this.service = AIServiceFactory.createService(config.provider, {
        apiKey:  config.apiKey,
        model:   config.model,
        baseUrl: config.baseUrl
      });
      this.provider = config.provider;
    } catch (err) {
      this.service = null;
      this.provider = null;
      console.error('[ChatAssistant] Error al configurar servicio AI:', err.message);
    }
  }

  isEnabled() {
    return !!this.service;
  }

  // ── God prompts ───────────────────────────────────────────────────────────

  setSystemPrompt(prompt) {
    this.systemPrompt = prompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  }

  getDefaultSystemPrompt() {
    return DEFAULT_SYSTEM_PROMPT;
  }

  setGamePrompt(gameId, prompt) {
    const key = gameId.startsWith('minecraft') ? 'minecraft' : gameId;
    if (prompt?.trim()) {
      this.gamePrompts[key] = prompt.trim();
    } else {
      delete this.gamePrompts[key];
    }
  }

  getGamePrompt(gameId) {
    const key = gameId.startsWith('minecraft') ? 'minecraft' : gameId;
    return this.gamePrompts[key] || null;
  }

  // ── Agent prompts ─────────────────────────────────────────────────────────

  setAgentPrompt(prompt) {
    this.agentPrompt = prompt?.trim() || DEFAULT_AGENT_PROMPT;
  }

  getDefaultAgentPrompt() {
    return DEFAULT_AGENT_PROMPT;
  }

  // ── Buffer de conversación ────────────────────────────────────────────────

  addToBuffer(gameId, player, message) {
    if (!this.messageBuffers[gameId]) {
      this.messageBuffers[gameId] = [];
    }
    const buf = this.messageBuffers[gameId];
    buf.push({ player, message });
    if (buf.length > BUFFER_SIZE) buf.shift();
  }

  getBufferContext(gameId, maxLines = CONTEXT_LINES) {
    const buf = this.messageBuffers[gameId] || [];
    const slice = buf.slice(-maxLines);
    return slice.map(m => `${m.player}: ${m.message}`).join('\n');
  }

  // ── Gestión de timers por servidor ────────────────────────────────────────

  /**
   * Activa el timer de God para un servidor.
   * Llamar al arrancar o reiniciar el servidor.
   */
  activateServer(gameId) {
    if (!this.isEnabled()) return;
    this._scheduleGodComment(gameId);
    this.logFn?.(`[God] Vigilancia activada para ${gameId}`);
  }

  /**
   * Desactiva el timer y limpia el buffer de un servidor.
   * Llamar al parar el servidor.
   */
  deactivateServer(gameId) {
    if (this.godTimers[gameId]) {
      clearTimeout(this.godTimers[gameId]);
      delete this.godTimers[gameId];
    }
    delete this.messageBuffers[gameId];
    this.logFn?.(`[God] Vigilancia desactivada para ${gameId}`);
  }

  _scheduleGodComment(gameId) {
    if (this.godTimers[gameId]) clearTimeout(this.godTimers[gameId]);

    const delay = GOD_TIMER_MIN_MS + Math.random() * (GOD_TIMER_MAX_MS - GOD_TIMER_MIN_MS);
    this.godTimers[gameId] = setTimeout(async () => {
      await this._sendSpontaneousComment(gameId);
      this._scheduleGodComment(gameId); // reprogramar
    }, delay);
  }

  async _sendSpontaneousComment(gameId) {
    if (!this.isEnabled() || !this.sendChatFn) return;
    if (this.processing) return; // hay una respuesta en curso, saltar

    const context = this.getBufferContext(gameId);
    if (!context) return; // sin conversación, God no habla al vacío

    this.processing = true;
    try {
      const prompt = this.buildGodSpontaneousPrompt(gameId, context);
      let response = await this.service.chat(prompt, {
        max_tokens:  150,
        temperature: 0.95
      });

      response = response.trim().replace(/\n+/g, ' ').trim();
      response = sanitizeMessage(response);

      const limit = GAME_CHAR_LIMITS[gameId] ?? 200;
      if (response.length > limit) response = response.slice(0, limit - 3) + '...';

      await this.sendChatFn(gameId, response, 'God');
      this.logFn?.(`[God] Comentario espontáneo en ${gameId}: "${response}"`);
    } catch (err) {
      this.logFn?.(`[God] Error en comentario espontáneo: ${err.message}`);
    } finally {
      this.processing = false;
    }
  }

  // ── Procesado de líneas de log ────────────────────────────────────────────

  /**
   * Procesa una línea de log de un servidor de juego.
   * - Añade mensajes de chat al buffer de conversación.
   * - Si contiene @god → responde inmediatamente con contexto.
   * - Si contiene @agent → responde inmediatamente sin personalidad.
   */
  async processLine(gameId, rawLine) {
    if (!this.isEnabled()) return;

    // 1. Extraer mensaje de chat para el buffer (todas las líneas de chat)
    const chatInfo = this.extractChatInfo(rawLine);
    if (chatInfo) {
      this.addToBuffer(gameId, chatInfo.player, chatInfo.message);
    }

    const hasGod   = GOD_MENTION.test(rawLine);
    const hasAgent = AGENT_MENTION.test(rawLine);
    if (!hasGod && !hasAgent) return;

    // 2. Respuesta directa a @god / @agent
    if (this.processing) return;

    const lastResponse = this.cooldowns.get(gameId) || 0;
    if (Date.now() - lastResponse < this.COOLDOWN_MS) return;

    // Usar chatInfo ya extraído, o intentar fallback genérico
    const info = chatInfo || this.extractGenericFallback(rawLine);
    if (!info) return;

    const { player, message } = info;
    const isAgent = hasAgent && !hasGod; // @god tiene prioridad
    const prefix  = isAgent ? 'Agent' : 'God';

    this.processing = true;
    this.cooldowns.set(gameId, Date.now());

    try {
      this.logFn?.(`[${prefix}] ${player} en ${gameId}: "${message}"`);

      const prompt = isAgent
        ? this.buildAgentPrompt(player, message, gameId)
        : this.buildGodPrompt(player, message, gameId);

      let response = await this.service.chat(prompt, {
        max_tokens:  150,
        temperature: isAgent ? 0.7 : 0.85
      });

      response = response.trim().replace(/\n+/g, ' ').trim();
      response = sanitizeMessage(response);

      const limit = GAME_CHAR_LIMITS[gameId] ?? 200;
      if (response.length > limit) response = response.slice(0, limit - 3) + '...';

      if (this.sendChatFn) {
        await this.sendChatFn(gameId, response, prefix);
        this.logFn?.(`[${prefix}] Respuesta enviada en ${gameId}: "${response}"`);
      }
    } catch (err) {
      this.logFn?.(`[${prefix}] Error al generar respuesta: ${err.message}`);
    } finally {
      this.processing = false;
    }
  }

  // ── Extracción de mensajes de chat ────────────────────────────────────────

  /**
   * Extrae player + message de líneas de chat estándar (Java, Bedrock).
   * Usado para alimentar el buffer de conversación.
   */
  extractChatInfo(line) {
    // Minecraft Java: [HH:MM:SS] [Server thread/INFO]: <PlayerName> mensaje
    const javaMatch = line.match(/<([^>]{1,20})>\s*(.+)/);
    if (javaMatch) return { player: javaMatch[1], message: javaMatch[2] };

    // Minecraft Bedrock: [INFO] Player message: PlayerName: mensaje
    const bedrockMatch = line.match(/(?:Player message|chat).*?:\s*([A-Za-z0-9_]{3,20}):\s*(.+)/i);
    if (bedrockMatch) return { player: bedrockMatch[1], message: bedrockMatch[2] };

    return null;
  }

  /**
   * Fallback genérico solo para líneas con @god/@agent cuando los formatos
   * estándar no coinciden (e.g. Hytale u otros formatos).
   */
  extractGenericFallback(line) {
    const genericMatch = line.match(/\b([A-Za-z0-9_]{3,20})\s*[>:]\s*(.+)/);
    if (genericMatch) return { player: genericMatch[1], message: genericMatch[2] };
    return { player: 'Unknown', message: line };
  }

  // ── Construcción de prompts ───────────────────────────────────────────────

  buildGodPrompt(player, message, gameId) {
    const question   = message.replace(/@god\b/gi, '').trim() || message;
    const gameName   = this._gameName(gameId);
    const basePrompt = this.getGamePrompt(gameId) || this.systemPrompt;
    const context    = this.getBufferContext(gameId);

    const contextBlock = context
      ? `\nÚltimos mensajes del chat:\n${context}\n`
      : '';

    return `${basePrompt}${contextBlock}\nContexto: servidor de ${gameName}.\nEl jugador "${player}" te invoca directamente: "${question}"\n\nResponde directamente:`;
  }

  buildGodSpontaneousPrompt(gameId, context) {
    const gameName   = this._gameName(gameId);
    const basePrompt = this.getGamePrompt(gameId) || this.systemPrompt;

    return `${basePrompt}\n\nContexto: servidor de ${gameName}.\nÚltimos mensajes del chat:\n${context}\n\nLos mortales no te han invocado. Observas su conversación y decides intervenir espontáneamente. Di algo breve e impactante sobre lo que está ocurriendo.\n\nResponde directamente:`;
  }

  buildAgentPrompt(player, message, gameId) {
    const question = message.replace(/@agent\b/gi, '').trim() || message;
    const gameName = this._gameName(gameId);
    return `${this.agentPrompt}\n\nContexto: servidor de ${gameName}.\nEl jugador "${player}" pregunta: "${question}"\n\nResponde directamente:`;
  }

  _gameName(gameId) {
    const names = {
      minecraft_java:    'Minecraft Java Edition',
      minecraft_bedrock: 'Minecraft Bedrock Edition',
      hytale:            'Hytale'
    };
    return names[gameId] ?? gameId;
  }
}

// Exportar como singleton
module.exports = new ChatAssistant();
