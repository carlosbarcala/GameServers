const OpenAIService = require('./providers/OpenAIService');
const GeminiService = require('./providers/GeminiService');
const OllamaService = require('./providers/OllamaService');
const ClaudeService = require('./providers/ClaudeService');

class AIServiceFactory {
    /**
     * Creates an AI service instance based on the provider type
     * @param {string} provider - 'openai', 'gemini', 'ollama', or 'claude'
     * @param {Object} config - Configuration for the specific provider
     * @returns {AIServiceInterface}
     */
    static createService(provider, config) {
        const type = provider.toLowerCase();

        switch (type) {
            case 'openai':
                return new OpenAIService(config);
            case 'gemini':
                return new GeminiService(config);
            case 'ollama':
                return new OllamaService(config);
            case 'claude':
                return new ClaudeService(config);
            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }
}

module.exports = AIServiceFactory;
