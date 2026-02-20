require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("❌ Error: GEMINI_API_KEY no está definida en el archivo .env");
    process.exit(1);
}

async function checkAvailableModels() {
    console.log("🔍 Consultando modelos disponibles en Google AI...");
    // Usamos la API REST directamente para evitar confusiones del SDK
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error("❌ Error devuelto por la API:", data.error.message);
            return;
        }

        const models = data.models || [];
        // Filtramos solo los que sirven para generar texto (generateContent)
        const chatModels = models.filter(m => m.supportedGenerationMethods.includes("generateContent"));

        console.log("\n✅ MODELOS DISPONIBLES PARA TU CUENTA:");
        console.log("=======================================");
        chatModels.forEach(m => {
            console.log(`👉 ${m.name.replace('models/', '')}`);
        });
        console.log("=======================================");
        console.log("💡 Copia uno de los nombres de arriba y ponlo en la variable MODEL_NAME en server.js");

    } catch (error) {
        console.error("❌ Error de conexión:", error);
    }
}

checkAvailableModels();