require('dotenv').config();

async function checkGroq() {
    const apiKey = process.env.GROQ_API_KEY;
    
    console.log("--- DIAGNÓSTICO GROQ ---");
    
    if (!apiKey) {
        console.error('❌ Error: GROQ_API_KEY no está definida en el archivo .env');
        return;
    }

    // Muestra los primeros caracteres para que confirmes visualmente si tomó la nueva
    console.log(`🔑 API Key cargada: ${apiKey.substring(0, 10)}...`);

    try {
        console.log("📡 Enviando petición de prueba a Groq (Modelo ligero)...");
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Responde solo con la palabra: OK' }],
                model: 'llama-3.1-8b-instant' // Usamos el modelo más rápido y barato
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error(`❌ FALLÓ GROQ: ${data.error?.message}`);
            if (data.error?.code === 'rate_limit_exceeded') {
                console.error("⚠️  Límite excedido. Tu cuenta gratuita puede estar saturada temporalmente.");
            }
        } else {
            console.log(`✅ ÉXITO: Groq respondió: "${data.choices[0].message.content}"`);
            console.log("🎉 Tu API Key nueva funciona perfectamente.");
        }
    } catch (error) {
        console.error(`❌ ERROR DE CONEXIÓN: ${error.message}`);
    }
}

checkGroq();