require('dotenv').config();

async function testKimi() {
    console.log('=== TEST KIMI AI ===');
    console.log('API Key exists:', !!process.env.KIMI_API_KEY);
    console.log('API Key preview:', process.env.KIMI_API_KEY ? process.env.KIMI_API_KEY.substring(0, 20) + '...' : 'NO KEY');
    
    try {
        const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Responde solo: OK' }],
                model: 'moonshot-v1-8k',
                temperature: 0.7
            })
        });
        
        console.log('Status:', response.status);
        const data = await response.json();
        
        if (!response.ok) {
            console.error('ERROR:', JSON.stringify(data, null, 2));
        } else {
            console.log('SUCCESS:', data.choices[0].message.content);
        }
    } catch (e) {
        console.error('EXCEPTION:', e.message);
    }
}

testKimi();
