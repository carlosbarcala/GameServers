const AIServiceInterface = require('../AIServiceInterface');

class ClaudeService extends AIServiceInterface {
    constructor(config) {
        super();
        this.apiKey = config.apiKey;
        this.model = config.model || 'claude-3-5-sonnet-20240620';
        this.apiUrl = config.apiUrl || 'https://api.anthropic.com/v1/messages';
    }

    async chat(prompt, options = {}) {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: options.model || this.model,
                    max_tokens: options.max_tokens || 1024,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: options.temperature || 0.7
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Claude Error: ${error.error?.message || response.statusText}`);
            }

            const data = await response.json();
            return data.content[0].text;
        } catch (error) {
            console.error('ClaudeService Error:', error);
            throw error;
        }
    }

    getName() {
        return 'Claude';
    }
}

module.exports = ClaudeService;
