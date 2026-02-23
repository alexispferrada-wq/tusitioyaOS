require('dotenv').config();

async function main() {
    const apiKey = process.env.KIMI_API_KEY;
    
    console.log("--- DIAGNÓSTICO KIMI AI (Moonshot) ---");
    
    if (!apiKey) {
        console.error('❌ Error: KIMI_API_KEY no está definida en el archivo .env');
        return;
    }

    console.log(`🔑 API Key detectada: ${apiKey.substring(0, 15)}...`);
    const modelName = 'moonshot-v1-8k';

    try {
        console.log(`🤖 Probando modelo: ${modelName}...`);
        const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Responde solo con la palabra: OK' }],
                model: modelName,
                temperature: 0.7
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || `HTTP ${response.status}`);
        }
        
        console.log(`✅ ÉXITO: El modelo respondió: "${data.choices[0].message.content.trim()}"`);
        console.log(`📊 Tokens usados: ${data.usage?.total_tokens || 'N/A'}`);
    } catch (error) {
        console.error(`❌ FALLÓ: ${error.message}`);
    }
}

main();
