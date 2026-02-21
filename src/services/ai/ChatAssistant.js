const AIServiceFactory = require('./AIServiceFactory');

// Detectar mención @god en cualquier línea de chat
const GOD_MENTION = /@god\b/i;

// Prompt por defecto (se puede sobreescribir desde el panel)
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

class ChatAssistant {
  constructor() {
    this.service = null;
    this.provider = null;
    this.sendChatFn = null; // async (gameId, message) => void
    this.logFn = null;      // broadcast function
    this.processing = false; // Evitar respuestas concurrentes
    this.cooldowns = new Map(); // gameId -> timestamp, evitar spam por servidor
    this.COOLDOWN_MS = 5000; // 5 segundos entre respuestas por servidor
    this.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Configura el servicio AI a usar
   * @param {Object} config - { provider: string, apiKey: string, model?: string, baseUrl?: string }
   */
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

  /**
   * Actualiza el prompt del sistema. Si se pasa vacío, restaura el default.
   * @param {string} prompt
   */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  }

  getDefaultSystemPrompt() {
    return DEFAULT_SYSTEM_PROMPT;
  }

  isEnabled() {
    return !!this.service;
  }

  /**
   * Procesa una línea de log de un servidor de juego.
   * Si contiene @god, extrae el mensaje y responde.
   * @param {string} gameId
   * @param {string} rawLine - Línea del log del servidor
   */
  async processLine(gameId, rawLine) {
    if (!this.isEnabled()) return;
    if (!GOD_MENTION.test(rawLine)) return;

    // Evitar respuestas concurrentes
    if (this.processing) return;

    // Cooldown por servidor para evitar spam
    const lastResponse = this.cooldowns.get(gameId) || 0;
    if (Date.now() - lastResponse < this.COOLDOWN_MS) return;

    const chatInfo = this.extractChatInfo(rawLine);
    if (!chatInfo) return;

    const { player, message } = chatInfo;

    this.processing = true;
    this.cooldowns.set(gameId, Date.now());

    try {
      this.logFn?.(`[God] ${player} en ${gameId} invoca a God: "${message}"`);

      const prompt = this.buildPrompt(player, message, gameId);
      let response = await this.service.chat(prompt, {
        max_tokens: 150,
        temperature: 0.85
      });

      // Limpiar respuesta: quitar comillas envolventes, saltos de línea
      response = response
        .trim()
        .replace(/^["'`]|["'`]$/g, '')
        .replace(/\n+/g, ' ')
        .trim();

      // Truncar si es demasiado larga (límite del chat de juego)
      if (response.length > 220) {
        response = response.slice(0, 217) + '...';
      }

      // Enviar respuesta al chat del juego
      if (this.sendChatFn) {
        await this.sendChatFn(gameId, response);
        this.logFn?.(`[God] Respuesta enviada en ${gameId}: "${response}"`);
      }
    } catch (err) {
      this.logFn?.(`[God] Error al generar respuesta: ${err.message}`);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Intenta extraer el nombre del jugador y el mensaje de una línea de log.
   * Soporta los formatos de Minecraft Java, Bedrock y formatos genéricos.
   * @param {string} line
   * @returns {{ player: string, message: string } | null}
   */
  extractChatInfo(line) {
    // Minecraft Java: [HH:MM:SS] [Server thread/INFO]: <PlayerName> mensaje
    const javaMatch = line.match(/<([^>]{1,20})>\s*(.+)/);
    if (javaMatch) {
      return { player: javaMatch[1], message: javaMatch[2] };
    }

    // Minecraft Bedrock: [INFO] Player message: PlayerName: mensaje
    const bedrockMatch = line.match(/(?:Player message|chat).*?:\s*([A-Za-z0-9_]{3,20}):\s*(.+)/i);
    if (bedrockMatch) {
      return { player: bedrockMatch[1], message: bedrockMatch[2] };
    }

    // Hytale y formato genérico: PlayerName: mensaje o PlayerName> mensaje
    const genericMatch = line.match(/\b([A-Za-z0-9_]{3,20})\s*[>:]\s*(.+)/);
    if (genericMatch && GOD_MENTION.test(genericMatch[2])) {
      return { player: genericMatch[1], message: genericMatch[2] };
    }

    // Último recurso: línea con @god sin jugador identificable
    if (GOD_MENTION.test(line)) {
      return { player: 'Unknown', message: line };
    }

    return null;
  }

  /**
   * Construye el prompt para el modelo AI
   */
  buildPrompt(player, message, gameId) {
    const question = message.replace(/@god\b/gi, '').trim() || message;
    const gameNames = {
      minecraft_java:    'Minecraft Java Edition',
      minecraft_bedrock: 'Minecraft Bedrock Edition',
      hytale:            'Hytale'
    };
    const gameName = gameNames[gameId] ?? gameId;
    return `${this.systemPrompt}\n\nContexto: el servidor de juego es ${gameName}.\nEl jugador "${player}" dice: "${question}"\n\nResponde directamente:`;
  }
}

// Exportar como singleton
module.exports = new ChatAssistant();
