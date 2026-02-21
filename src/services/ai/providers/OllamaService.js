const AIServiceInterface = require('../AIServiceInterface');

class OllamaService extends AIServiceInterface {
    constructor(config) {
        super();
        // Local: 'http://localhost:11434'  |  Cloud: 'https://ollama.com'
        this.baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
        this.model = config.model || 'llama3';
        // apiKey solo es necesario en modo cloud; en local se ignora
        this.apiKey = config.apiKey || null;
    }

    async chat(prompt, options = {}) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: options.model || this.model,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                    options: {
                        temperature: options.temperature || 0.7
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama Error: ${errorText || response.statusText}`);
            }

            const data = await response.json();
            return data.message.content;
        } catch (error) {
            console.error('OllamaService Error:', error);
            throw error;
        }
    }

    getName() {
        return this.apiKey ? 'Ollama Cloud' : 'Ollama Local';
    }
}

module.exports = OllamaService;
