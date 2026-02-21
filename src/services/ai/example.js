const AIServiceFactory = require('./AIServiceFactory');

// Example configuration (usually from .env or database)
const configs = {
    openai: {
        apiKey: 'sk-...'
    },
    gemini: {
        apiKey: 'AIza...'
    },
    ollama: {
        baseUrl: 'http://localhost:11434',
        model: 'llama3'
    },
    claude: {
        apiKey: 'sk-ant-...'
    }
};

async function testAI() {
    try {
        console.log("--- Testing AI Services ---");

        // 1. Using OpenAI
        // const openai = AIServiceFactory.createService('openai', configs.openai);
        // const res1 = await openai.chat("Hello, how are you?");
        // console.log("OpenAI Response:", res1);

        // 2. Using Ollama (often used for development/local)
        const ollama = AIServiceFactory.createService('ollama', configs.ollama);
        console.log("Requesting Ollama...");
        // const res2 = await ollama.chat("Explícame qué es un servidor de juegos en una frase.");
        // console.log("Ollama Response:", res2);

        console.log("AI Factory initialized successfully.");
        console.log("Available providers: OpenAI, Gemini, Ollama, Claude.");

    } catch (error) {
        console.error("Test failed:", error.message);
    }
}

// testAI();

module.exports = testAI;
