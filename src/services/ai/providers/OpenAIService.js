const AIServiceInterface = require('../AIServiceInterface');

class OpenAIService extends AIServiceInterface {
    constructor(config) {
        super();
        this.apiKey = config.apiKey;
        this.model = config.model || 'gpt-4o';
        this.apiUrl = config.apiUrl || 'https://api.openai.com/v1/chat/completions';
    }

    async chat(prompt, options = {}) {
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: options.model || this.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: options.temperature || 0.7
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`OpenAI Error: ${error.error?.message || response.statusText}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('OpenAIService Error:', error);
            throw error;
        }
    }

    getName() {
        return 'OpenAI';
    }
}

module.exports = OpenAIService;
