/**
 * Interface for AI Services
 */
class AIServiceInterface {
    /**
     * Sends a prompt to the AI model
     * @param {string} prompt - The prompt to send
     * @param {Object} options - Additional options (model, temperature, etc.)
     * @returns {Promise<string>} - The response from the AI
     */
    async chat(prompt, options = {}) {
        throw new Error("Method 'chat()' must be implemented.");
    }

    /**
     * Gets the name of the service provider
     * @returns {string}
     */
    getName() {
        throw new Error("Method 'getName()' must be implemented.");
    }
}

module.exports = AIServiceInterface;
