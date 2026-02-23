require('dotenv').config();

console.log('=== DEBUG VARIABLES DE ENTORNO ===');
console.log('KIMI_API_KEY cargada:', process.env.KIMI_API_KEY ? 'SÍ' : 'NO');
console.log('KIMI_API_KEY valor:', process.env.KIMI_API_KEY);
console.log('KIMI_API_KEY longitud:', process.env.KIMI_API_KEY?.length);
console.log('');
console.log('Primeros 30 chars:', process.env.KIMI_API_KEY?.substring(0, 30));
console.log('Últimos 10 chars:', process.env.KIMI_API_KEY?.substring(process.env.KIMI_API_KEY.length - 10));
