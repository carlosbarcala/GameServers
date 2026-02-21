const AIServiceInterface = require('../AIServiceInterface');

class GeminiService extends AIServiceInterface {
    constructor(config) {
        super();
        this.apiKey = config.apiKey;
        this.model = config.model || 'gemini-1.5-flash';
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    }

    async chat(prompt, options = {}) {
        try {
            // Re-construct URL if model is changed in options
            const model = options.model || this.model;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: options.temperature || 0.7
                    }
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Gemini Error: ${error.error?.message || response.statusText}`);
            }

            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
        } catch (error) {
            console.error('GeminiService Error:', error);
            throw error;
        }
    }

    getName() {
        return 'Gemini';
    }
}

module.exports = GeminiService;
