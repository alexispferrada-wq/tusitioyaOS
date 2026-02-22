require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    
    console.log("--- DIAGNÓSTICO GEMINI ---");
    
    if (!apiKey) {
        console.error('❌ Error: GEMINI_API_KEY no está definida en el archivo .env');
        return;
    }

    console.log(`🔑 API Key detectada: ${apiKey.substring(0, 8)}...`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = 'gemini-2.0-flash';

    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        console.log(`🤖 Probando modelo: ${modelName}...`);
        const result = await model.generateContent('Responde solo con la palabra: OK');
        console.log(`✅ ÉXITO: El modelo respondió: "${result.response.text().trim()}"`);
    } catch (error) {
        console.error(`❌ FALLÓ: ${error.message}`);
    }
}

main();