const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
    console.error("❌ Error: OPENROUTER_API_KEY no está definida en el archivo .env");
    console.error("\nℹ️  PASOS PARA SOLUCIONARLO:");
    console.error("   1. Ve a https://openrouter.ai/keys y crea una API Key (es gratis).");
    console.error("   2. Abre el archivo .env en la carpeta de tu proyecto.");
    console.error("   3. Agrega una línea nueva al final: OPENROUTER_API_KEY=sk-or-tu_clave_aqui");
    process.exit(1);
}

async function checkOpenRouter() {
    console.log("🔍 Conectando a OpenRouter...");
    
    try {
        // 1. Verificar Créditos/Cuenta
        const authResponse = await fetch('https://openrouter.ai/api/v1/auth/key', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        if (authResponse.ok) {
            const authData = await authResponse.json();
            const data = authData.data;
            console.log("\n💳 ESTADO DE CUENTA:");
            console.log(`   Label: ${data.label}`);
            console.log(`   Uso: $${data.usage}`);
            console.log(`   Límite: ${data.limit ? '$' + data.limit : 'Ilimitado/Prepagado'}`);
        } else {
            console.log("⚠️ No se pudo verificar el estado de la cuenta (API Key inválida o error de red).");
        }

        // 2. Listar Modelos Gratuitos
        console.log("\n🔍 Buscando modelos gratuitos...");
        const modelsResponse = await fetch('https://openrouter.ai/api/v1/models');
        const modelsData = await modelsResponse.json();
        
        if (!modelsData.data) {
            console.error("❌ Error al obtener modelos.");
            return;
        }

        const freeModels = modelsData.data.filter(m => {
            const promptPrice = parseFloat(m.pricing?.prompt || 0);
            const completionPrice = parseFloat(m.pricing?.completion || 0);
            return promptPrice === 0 && completionPrice === 0;
        }).sort((a, b) => a.id.localeCompare(b.id));

        console.log(`\n✅ ENCONTRADOS ${freeModels.length} MODELOS GRATUITOS:`);
        console.log("==================================================");
        
        // Formato listo para copiar y pegar en el array de JS
        freeModels.forEach(m => {
            console.log(`"openrouter-${m.id}",`);
        });
        
        console.log("==================================================");
        console.log("📋 Copia los modelos de arriba y pégalos en la lista GEMINI_MODELS en previo_comando.html");

    } catch (error) {
        console.error("❌ Error de conexión:", error.message);
    }
}

checkOpenRouter();