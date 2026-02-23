require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

const app = express();
const port = process.env.PORT || 3000;

// Función para generar un código profesional único (Ej: TSY-A7B2-9X1P)
function generarCodigoSeguimiento() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sin O, I, 0, 1 para evitar confusión
  const gen = (len) => Array.from({length: len}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  return `TSY-${gen(4)}-${gen(4)}`;
}

// Middleware
app.use(cors()); // Permite que tu HTML local se conecte aquí
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para parsear datos de formularios
app.use(express.static(__dirname)); // Servir archivos estáticos (HTML, etc.)

// Middleware de Logging para depuración
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Verificación rápida: Asegurar que la variable de entorno existe
if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR CRÍTICO: No se encontró la variable de entorno DATABASE_URL.");
  console.error("   -> En Local: Verifica que exista en tu archivo .env");
  console.error("   -> En Render: Agrégala en la sección 'Environment Variables' del dashboard.");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ ERROR CRÍTICO: No se encontró la variable de entorno GEMINI_API_KEY.");
  console.error("   -> En Local: Verifica que exista en tu archivo .env");
  console.error("   -> En Render: Agrégala en la sección 'Environment Variables' del dashboard.");
  process.exit(1);
}

// Configuración de KIMI AI (Moonshot)
const KIMI_API_KEY = process.env.KIMI_API_KEY;
if (!KIMI_API_KEY) {
  console.warn("⚠️ ADVERTENCIA: No se encontró KIMI_API_KEY. El modelo Kimi AI no estará disponible.");
}

// Limpiar connection string para evitar advertencias de SSL en consola
let connectionString = process.env.DATABASE_URL;
if (connectionString && connectionString.includes('sslmode=require')) {
  connectionString = connectionString.replace(/(\?|&)sslmode=require/, '');
}

// 1. Conexión a NEON (PostgreSQL)
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false // Requerido para conexiones a Neon.tech y la mayoría de nubes
  },
  // Configuración para mayor resiliencia con bases de datos en la nube
  connectionTimeoutMillis: 30000, // Aumentado a 30 segundos para conectar
  idleTimeoutMillis: 600000,      // Aumentado a 10 minutos para cerrar una conexión inactiva
});

// Manejo de errores del pool para evitar caídas por desconexiones inesperadas
pool.on('error', (err, client) => {
  console.error('❌ Error inesperado en cliente inactivo de la base de datos:', err);
  // No matamos el proceso, permitimos que el pool maneje la reconexión
});

// 2. Conexión a GEMINI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Define aquí el modelo que te arroje el script check_models.js (ej: gemini-1.5-flash, gemini-pro, etc.)
const MODEL_NAME = "gemini-2.0-flash"; // Modelo por defecto actualizado

// ============================================================
// VERIFICACIÓN DE ESTADO DE APIs DE IA
// ============================================================
const verificarEstadoIAs = async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 VERIFICACIÓN DE APIs DE INTELIGENCIA ARTIFICIAL');
    console.log('='.repeat(60));
    
    const resultados = {
        gemini: { status: '⏳', color: '\x1b[33m', mensaje: 'Verificando...' },
        groq: { status: '⏳', color: '\x1b[33m', mensaje: 'Verificando...' },
        kimi: { status: '⏳', color: '\x1b[33m', mensaje: 'Verificando...' }
    };
    
    const resetColor = '\x1b[0m';
    const greenColor = '\x1b[32m';
    const redColor = '\x1b[31m';
    const yellowColor = '\x1b[33m';
    
    // Función para mostrar resultado
    const mostrarResultado = (nombre, estado) => {
        const icon = estado.status === '✅' ? '✅' : estado.status === '❌' ? '❌' : '⏳';
        console.log(`${icon} ${nombre.padEnd(12)} | ${estado.mensaje}`);
    };
    
    // 1. VERIFICAR GEMINI
    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('API Key no configurada');
        }
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent('Responde: OK');
        const text = result.response.text();
        
        if (text && text.includes('OK')) {
            resultados.gemini = { status: '✅', mensaje: 'ONLINE - Respuesta verificada' };
        } else {
            resultados.gemini = { status: '⚠️', mensaje: 'RESPUESTA INESPERADA' };
        }
    } catch (error) {
        resultados.gemini = { 
            status: '❌', 
            mensaje: `OFFLINE - ${error.message.substring(0, 40)}...` 
        };
    }
    mostrarResultado('GEMINI', resultados.gemini);
    
    // 2. VERIFICAR GROQ
    try {
        if (!process.env.GROQ_API_KEY) {
            throw new Error('API Key no configurada');
        }
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Responde: OK' }],
                model: 'llama-3.1-8b-instant'
            })
        });
        
        if (response.ok) {
            resultados.groq = { status: '✅', mensaje: 'ONLINE - Respuesta verificada' };
        } else {
            const data = await response.json();
            throw new Error(data.error?.message || `HTTP ${response.status}`);
        }
    } catch (error) {
        resultados.groq = { 
            status: '❌', 
            mensaje: `OFFLINE - ${error.message.substring(0, 40)}...` 
        };
    }
    mostrarResultado('GROQ', resultados.groq);
    
    // 3. VERIFICAR KIMI (MOONSHOT)
    try {
        if (!process.env.KIMI_API_KEY) {
            throw new Error('API Key no configurada');
        }
        const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'Responde: OK' }],
                model: 'moonshot-v1-8k',
                temperature: 0.7
            })
        });
        
        if (response.ok) {
            resultados.kimi = { status: '✅', mensaje: 'ONLINE - Respuesta verificada' };
        } else {
            const data = await response.json();
            throw new Error(data.error?.message || `HTTP ${response.status}`);
        }
    } catch (error) {
        resultados.kimi = { 
            status: '❌', 
            mensaje: `OFFLINE - ${error.message.substring(0, 40)}...` 
        };
    }
    mostrarResultado('KIMI AI', resultados.kimi);
    
    console.log('='.repeat(60));
    
    // Resumen final
    const online = Object.values(resultados).filter(r => r.status === '✅').length;
    const offline = Object.values(resultados).filter(r => r.status === '❌').length;
    const warning = Object.values(resultados).filter(r => r.status === '⚠️').length;
    
    if (online === 3) {
        console.log(`🎉 TODAS LAS IAs ESTÁN ONLINE (${online}/3)`);
    } else if (online > 0) {
        console.log(`⚠️  IAs DISPONIBLES: ${online}/3 | OFFLINE: ${offline} | ADVERTENCIAS: ${warning}`);
    } else {
        console.log(`🔴 ALERTA: NINGUNA IA ESTÁ DISPONIBLE - El sistema no podrá generar leads`);
    }
    
    console.log('='.repeat(60) + '\n');
    
    return resultados;
};

// 3. Configuración de Multer (Subida de Archivos)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const clienteId = req.params.cliente_id;
    
    // Validación básica de seguridad para el ID
    if (!clienteId || clienteId === 'undefined') {
      return cb(new Error('ID de cliente no proporcionado o inválido'));
    }

    // Ruta dinámica: uploads/cliente_id/
    const uploadPath = path.join(__dirname, 'uploads', clienteId);

    // Crear carpeta recursivamente si no existe
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Mantener extensión original y añadir timestamp para evitar colisiones
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB por archivo (opcional, buena práctica)
  fileFilter: function (req, file, cb) {
    // Expresión regular para tipos permitidos
    const filetypes = /jpeg|jpg|png|pdf/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Error: Tipo de archivo no soportado. Solo se permiten imágenes (JPG, PNG) y PDFs.'));
  }
});

// --- RUTAS (ENDPOINTS) ---

// 0. Autenticación y Registro
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Login simple (En producción usar bcrypt para contraseñas)
        const result = await pool.query(
            'SELECT id, username, email, plan_id, creditos_restantes FROM usuarios WHERE (username = $1 OR email = $1) AND password = $2', 
            [username, password]
        );
        
        if (result.rows.length > 0) {
            res.json({ status: 'success', user: result.rows[0] });
        } else {
            res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error en el servidor.' });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const check = await pool.query('SELECT id FROM usuarios WHERE username = $1 OR email = $2', [username, email]);
        if (check.rows.length > 0) return res.status(400).json({ error: 'El usuario o correo ya existe.' });

        // Plan 1 = Gratuito (20 créditos de regalo)
        const result = await pool.query(
            'INSERT INTO usuarios (username, email, password, plan_id, creditos_restantes, created_at) VALUES ($1, $2, $3, 1, 20, NOW()) RETURNING id, username, creditos_restantes',
            [username, email, password]
        );
        res.json({ status: 'success', user: result.rows[0] });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al registrar usuario.' });
    }
});

// Ruta de prueba para ver si el servidor vive
app.get('/', (req, res) => {
  // Redirigir a la página de login que luego lleva al dashboard.
  res.redirect('/generador_prospectos_ia.html');
});
 
// Fix para móviles: Redirigir rutas sin extensión a la vista correcta
app.get('/previo_comando', (req, res) => {
  res.redirect('/previo_comando.html');
});

app.get('/dashboard', (req, res) => {
  res.redirect('/dashboard.html');
});

// Endpoint de Subida de Archivos (Requerimiento Específico)
app.post('/api/subir-archivos/:cliente_id', upload.array('archivos'), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se han subido archivos.' });
    }

    res.status(201).json({
      message: 'Archivos subidos correctamente.',
      cliente_id: req.params.cliente_id,
      files: req.files.map(f => ({ originalName: f.originalname, filename: f.filename, path: f.path }))
    });

  } catch (error) {
    console.error('❌ Error en subida de archivos:', error);
    res.status(500).json({ error: 'Error interno al procesar los archivos.' });
  }
});

// A. Obtener todos los clientes (Para llenar la barra lateral)
app.get('/api/clientes', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT * FROM clientes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error en GET /api/clientes:', err);
    res.status(500).json({ error: 'Error al obtener clientes desde la base de datos.' });
  } finally {
    if (client) {
      client.release(); // Asegurarse de que el cliente se libere de vuelta al pool
    }
  }
});

// A.1 Obtener un cliente específico (Para Hoja de Ruta)
app.get('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await pool.connect();
    // Permite buscar por ID numérico o por el nuevo Código de Seguimiento
    const result = await client.query('SELECT * FROM clientes WHERE id::text = $1 OR codigo_seguimiento = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en GET /api/clientes/:id:', err);
    res.status(500).json({ error: 'Error al obtener cliente.' });
  } finally {
    if (client) client.release();
  }
});

// A.1.5 Generar Prospectos con IA (NUEVO)
app.post('/api/prospectar', async (req, res) => {
  const { prompt, ciudad, model: modelName } = req.body;
  
  try {
    const intentarGenerar = async (modelo) => {
        const controller = new AbortController();
        // Un timeout generoso de 45 segundos. A veces la primera llamada a la IA es lenta.
        const timeoutId = setTimeout(() => {
            console.log(`[PROSPECTAR] ⏰ Timeout para el modelo ${modelo} después de 45 segundos.`);
            controller.abort();
        }, 45000);

        try {
            if (modelo.startsWith('openrouter-')) {
                const orModel = modelo.replace('openrouter-', '').replace(':free', '');
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'http://localhost:3000',
                        'X-Title': 'TuSitioYa OS'
                    },
                    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: orModel }),
                    signal: controller.signal
                });
                const data = await response.json();
                if (!response.ok) throw new Error(`OpenRouter: ${data.error?.message || JSON.stringify(data)}`);
                const text = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '');
                const parsed = JSON.parse(text);
                return Array.isArray(parsed) ? parsed : parsed.prospectos;
            } else if (modelo.startsWith('groq-') || modelo.includes('llama')) {
                const groqModel = modelo.replace('groq-', '');
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: prompt }],
                        model: groqModel || 'llama-3.1-8b-instant',
                        response_format: { type: "json_object" }
                    }),
                    signal: controller.signal
                });
                const data = await response.json();
                if (!response.ok) throw new Error(`Groq: ${data.error?.message || 'Error desconocido'}`);
                const groqContent = JSON.parse(data.choices[0].message.content);
                return groqContent.prospectos;
            } else {
                // Para el SDK de Gemini, que no soporta AbortController, usamos Promise.race
                const modelToUse = modelo || MODEL_NAME;
                const model = genAI.getGenerativeModel({ model: modelToUse });
                
                const generationPromise = model.generateContent(prompt);
                const timeoutPromise = new Promise((_, reject) => 
                  setTimeout(() => reject(new Error(`La petición a Gemini (${modelToUse}) excedió los 45 segundos.`)), 45000)
                );
    
                const result = await Promise.race([generationPromise, timeoutPromise]);
                const response = await result.response;
                const text = response.text().replace(/```json/g, '').replace(/```/g, '');
                const parsed = JSON.parse(text);
                return Array.isArray(parsed) ? parsed : parsed.prospectos;
            }
        } finally {
            clearTimeout(timeoutId); // Es importante limpiar el timeout
        }
    };

    let prospectos;
    let errorInicial;
    let modelToUse = modelName || MODEL_NAME;

    try {
        console.log(`[PROSPECTAR] 🚀 Ejecutando búsqueda con modelo principal: ${modelToUse}`);
        prospectos = await intentarGenerar(modelToUse);
    } catch (e) {
        console.warn(`[PROSPECTAR] ⚠️ Falló el modelo principal (${modelToUse}). Intentando fallback...`, e.message);
        errorInicial = e;
        // Fallback: Si falló Gemini, prueba Groq. Si falló Groq, prueba Gemini.
        try {
            const fallbackModel = modelToUse.includes('gemini') ? 'groq-llama-3.1-8b-instant' : 'gemini-2.0-flash';
            console.log(`[PROSPECTAR] 🚀 Ejecutando fallback con: ${fallbackModel}`);
            prospectos = await intentarGenerar(fallbackModel);
        } catch (e2) {
            console.warn(`[PROSPECTAR] ⚠️ Falló el segundo intento. Probando OpenRouter (Gemma 2 Free)...`, e2.message);
            // Tercer intento: OpenRouter (Modelo gratuito de Google)
            try {
                console.log(`[PROSPECTAR] 🚀 Ejecutando último fallback con: openrouter-google/gemma-2-9b-it`);
                prospectos = await intentarGenerar('openrouter-google/gemma-2-9b-it'); // Usar el ID limpio
            } catch (e3) {
                throw new Error(`Todos los modelos fallaron. Gemini: ${errorInicial.message}. Groq: ${e2.message}. OpenRouter: ${e3.message}`);
            }
        }
    }

    console.log(`[PROSPECTAR] ✅ IA respondió. Procesando ${prospectos?.length || 0} prospectos...`);
    res.json(prospectos);
  } catch (err) {
    if (err.message && err.message.includes('Groq')) {
      console.error("❌ ERROR GROQ:", err.message); // This might be a quota issue
    } else if (err.message && err.message.includes('404')) {
      console.error("❌ ERROR GEMINI: Modelo no encontrado. Verifica tu API Key.");
    } else if (err.message && (err.message.includes('403') || err.message.includes('SERVICE_DISABLED'))) {
      console.error("❌ ERROR GEMINI: API no habilitada. Ve a la consola de Google Cloud y habilita 'Generative Language API'.");
    } else if (err.message && err.message.includes('429')) {
      console.error("⏳ ERROR GEMINI: Cuota excedida (429). Espera unos momentos.");
      return res.status(429).json({ error: 'La IA está saturada. Por favor espera 1 minuto e intenta de nuevo.' });
      console.error("⏳ ERROR DE CUOTA (429): Todos los modelos están saturados.");
      return res.status(429).json({ error: "IA's saturadas (trabajando para liberar cuotas, intenta en 15 minutos)." });
    } else {
      console.error('❌ Error Inesperado en /api/prospectar:', err);
    }
    res.status(500).json({ error: err.message || 'Error generando prospectos' });
  }
});

// A.1.6 Guardar Prospectos en Lote (Bulk)
app.post('/api/prospectos/bulk', async (req, res) => {
  const { prospects, ciudad } = req.body;

  if (!prospects || !Array.isArray(prospects) || prospects.length === 0) {
    return res.status(400).json({ error: 'No se proporcionaron prospectos para guardar.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN'); // Iniciar transacción

    const guardados = [];
    const errores = [];

    for (const p of prospects) {
      try {
        // Normalización de claves (por si la IA usa mayúsculas)
        const negocio = p.negocio || p.Negocio;
        const nombre = p.nombre || p.Nombre;
        const whatsapp = p.whatsapp || p.Whatsapp || p.WhatsApp;
        const dominio = p.dominio_sugerido || p.Dominio_Sugerido || p.dominio;
        const propuesta = p.propuesta_text || p.Propuesta_Text || p.propuesta;
        
        // Nuevos campos solicitados
        const rut = p.rut || p.Rut || null;
        const email = p.email || p.Email || null;
        const rubro = p.rubro || p.Rubro || null;
        const url = p.url || p.Url || p.URL || null;

        if (!p || typeof p !== 'object' || !negocio) {
            errores.push({ prospecto: p, error: 'Prospecto inválido o sin nombre de negocio.' });
            continue;
        };

        // Verificación de Duplicados por RUT
        if (rut) {
            const checkQuery = 'SELECT id FROM clientes WHERE rut = $1';
            const checkRes = await client.query(checkQuery, [rut]);
            if (checkRes.rows.length > 0) {
                errores.push({ prospecto: negocio, error: `RUT ${rut} ya existe en la base de datos.` });
                continue;
            }
        }

        // Preparamos datos extra para encuesta_data
        const encuestaData = {
            email: email,
            rubro: rubro,
            url: url
        };

        const codigo = generarCodigoSeguimiento();
        const query = `
          INSERT INTO clientes (nombre, negocio, whatsapp, dominio, monto_total, estado, propuesta_text, ciudad, rut, encuesta_data, codigo_seguimiento, created_at)
          VALUES ($1, $2, $3, $4, $5, 'prospecto', $6, $7, $8, $9, $10, NOW())
          RETURNING *
        `;
        const resDB = await client.query(query, [nombre, negocio, whatsapp, dominio, 72000, propuesta, ciudad, rut, encuestaData, codigo]);
        guardados.push(resDB.rows[0]);
      } catch (err) {
        console.error('❌ Error al insertar prospecto:', p.negocio);
        console.error('❌ Detalle del error DB:', err.message);
        errores.push({ prospecto: p.negocio, error: err.message });
      }
    }

    if (errores.length > 0) {
      await client.query('ROLLBACK');
      console.error('⚠️ Transacción revertida. Errores encontrados:', errores);
      return res.status(500).json({ error: 'Algunos prospectos no se pudieron guardar.', detalles: errores });
    }

    await client.query('COMMIT');
    console.log(`✅ Insertados ${guardados.length} prospectos correctamente.`);
    res.status(201).json({ message: `${guardados.length} prospectos guardados con éxito.`, data: guardados });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Error crítico en transacción de lote:', err);
    res.status(500).json({ error: 'Error crítico en la base de datos durante la transacción.' });
  } finally {
    if (client) client.release();
  }
});

// A.2 Crear nuevo cliente (Nuevo Prospecto)
app.post('/api/clientes', async (req, res) => {
  const { nombre, rut, negocio, whatsapp, dominio, monto_total, propuesta_text, email, rubro, url } = req.body;
  
  let client;
  try {
    client = await pool.connect();
    
    const encuestaData = {
        email: email || null,
        rubro: rubro || null,
        url: url || null
    };
    
    const codigo = generarCodigoSeguimiento();
    const query = `
      INSERT INTO clientes (nombre, rut, negocio, whatsapp, dominio, monto_total, monto_pagado, propuesta_text, encuesta_data, codigo_seguimiento, estado, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'prospecto', NOW())
      RETURNING *
    `;
    const values = [nombre, rut, negocio, whatsapp, dominio, monto_total, propuesta_text, encuestaData, codigo];
    const result = await client.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Error al crear cliente: ${err.message}` });
  } finally {
    if (client) client.release();
  }
});

// A.3 Editar cliente (Guardar cambios de montos)
app.put('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;
  const { 
      monto_total, monto_pagado, whatsapp, nombre, negocio, dominio, fecha_agendada,
      fecha_proximo_pago, monto_mantencion, rut, propuesta_text,
      email, rubro, url, // from encuesta_data
      respuestas_web, // Nuevo campo para la encuesta de 7 preguntas
      encuesta_data // Permitir recibir el objeto completo para merge
  } = req.body;

  let client;
  try {
    client = await pool.connect();
    
    let setClauses = [];
    let params = [];
    let paramIndex = 1;

    if (monto_total !== undefined) { setClauses.push(`monto_total = $${paramIndex++}`); params.push(monto_total); }
    if (monto_pagado !== undefined) { setClauses.push(`monto_pagado = $${paramIndex++}`); params.push(monto_pagado); }
    if (whatsapp !== undefined) { setClauses.push(`whatsapp = $${paramIndex++}`); params.push(whatsapp); }
    if (nombre !== undefined) { setClauses.push(`nombre = $${paramIndex++}`); params.push(nombre); }
    if (negocio !== undefined) { setClauses.push(`negocio = $${paramIndex++}`); params.push(negocio); }
    if (dominio !== undefined) { setClauses.push(`dominio = $${paramIndex++}`); params.push(dominio); }
    if (fecha_proximo_pago !== undefined) { setClauses.push(`fecha_proximo_pago = $${paramIndex++}`); params.push(fecha_proximo_pago); }
    if (fecha_agendada !== undefined) { setClauses.push(`fecha_seguimiento = $${paramIndex++}`); params.push(fecha_agendada); }
    if (rut !== undefined) { setClauses.push(`rut = $${paramIndex++}`); params.push(rut); }
    if (propuesta_text !== undefined) { setClauses.push(`propuesta_text = $${paramIndex++}`); params.push(propuesta_text); }

    // Handle JSONB merge
    let encuestaUpdates = encuesta_data || {}; // Usar datos pasados o iniciar vacío
    if (monto_mantencion !== undefined) encuestaUpdates.monto_mantencion = monto_mantencion;
    if (email !== undefined) encuestaUpdates.email = email;
    if (rubro !== undefined) encuestaUpdates.rubro = rubro;
    if (url !== undefined) encuestaUpdates.url = url;
    if (respuestas_web !== undefined) encuestaUpdates.respuestas_web = respuestas_web;

    if (Object.keys(encuestaUpdates).length > 0) {
        setClauses.push(`encuesta_data = COALESCE(encuesta_data, '{}'::jsonb) || $${paramIndex++}`);
        params.push(encuestaUpdates);
    }
    
    if (setClauses.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    const query = `UPDATE clientes SET ${setClauses.join(', ')} WHERE id = $${paramIndex++} RETURNING *`;
    params.push(id);

    const result = await client.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en PUT /api/clientes/:id :', err);
    res.status(500).json({ error: 'Error al actualizar cliente' });
  } finally {
    if (client) client.release();
  }
});

// A.4 Cambiar Estado (Para el flujo de ventas)
app.patch('/api/clientes/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado, motivo } = req.body; // 'contactado', 'no_interesado', 'cliente'

  let client;
  try {
    client = await pool.connect();
    let query;
    let params = [estado, id];

    if (estado === 'contactado') {
      // Si contactamos, guardamos la fecha actual automáticamente
      query = "UPDATE clientes SET estado = $1, fecha_contacto = NOW() WHERE id = $2 RETURNING *";
    } else if (estado === 'no_interesado' && motivo) {
      // Si descartamos con motivo, lo guardamos en el JSONB de encuesta_data para persistencia
      query = `
        UPDATE clientes 
        SET estado = $1, encuesta_data = jsonb_set(COALESCE(encuesta_data, '{}'), '{motivo_descarte}', to_jsonb($3::text), true) 
        WHERE id = $2 RETURNING *`;
      params = [estado, id, motivo];
    } else {
      query = "UPDATE clientes SET estado = $1 WHERE id = $2 RETURNING *";
    }
    
    const result = await client.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en PATCH /api/clientes/:id/estado :', err);
    res.status(500).json({ error: 'Error al cambiar estado del cliente.' });
  } finally {
    if (client) client.release();
  }
});

// A.5 Eliminar un cliente/prospecto
app.delete('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;

  let client;
  try {
    client = await pool.connect();
    const query = 'DELETE FROM clientes WHERE id = $1';
    const result = await client.query(query, [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado para eliminar' });
    }

    res.status(204).send(); // Éxito, sin contenido
  } catch (err) {
    console.error('❌ Error en DELETE /api/clientes/:id :', err);
    res.status(500).json({ error: 'Error al eliminar el cliente.' });
  } finally {
    if (client) client.release();
  }
});


// B. Analizar Chat con Gemini
app.post('/api/analizar-chat', async (req, res) => {
  const { prompt, model: modelName } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Falta el prompt de análisis' });
  }

  // Usamos el prompt completo que viene del frontend (Instrucciones + Historial)
  const detailedPrompt = prompt;

  try {
    let analisisText;

    if (modelName && modelName.startsWith('openrouter-')) {
      const orModel = modelName.replace('openrouter-', '').replace(':free', ''); // Limpiar el sufijo :free
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'http://localhost:3000',
              'X-Title': 'TuSitioYa OS'
          },
          body: JSON.stringify({
              messages: [{ role: 'user', content: detailedPrompt }],
              model: orModel
          })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`OpenRouter API Error: ${data.error?.message}`);
      analisisText = data.choices[0].message.content;
    } else if (modelName && modelName.startsWith('kimi-')) {
      // KIMI AI (Moonshot) - API compatible con OpenAI
      const kimiModel = modelName.replace('kimi-', '');
      const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              messages: [{ role: 'user', content: detailedPrompt }],
              model: kimiModel || 'moonshot-v1-8k',
              temperature: 0.7
          })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Kimi API Error: ${data.error?.message || JSON.stringify(data)}`);
      analisisText = data.choices[0].message.content;
    } else if (modelName && modelName.startsWith('groq-')) {
      const groqModel = modelName.replace('groq-', '');
      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
              'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              messages: [{ role: 'user', content: detailedPrompt }],
              model: groqModel,
              response_format: { type: "json_object" }
          })
      });
      const data = await groqResponse.json();
      if (!groqResponse.ok) throw new Error(`Groq API Error: ${data.error.message}`);
      analisisText = data.choices[0].message.content;
    } else {
      const modelToUse = modelName || MODEL_NAME;
      try {
        const model = genAI.getGenerativeModel({ model: modelToUse });
        const result = await model.generateContent(detailedPrompt);
        const response = await result.response;
        analisisText = response.text();
      } catch (err) {
        // Fallback automático si Gemini falla (ej: Cuota 429 o Sobrecarga)
        if (process.env.GROQ_API_KEY && (err.message.includes('429') || err.message.includes('Quota') || err.message.includes('503'))) {
            console.warn(`⚠️ Gemini falló por cuota (${modelToUse}). Usando respaldo Groq (Llama 3)...`);
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: detailedPrompt }],
                    model: 'llama-3.1-8b-instant'
                })
            });
            const data = await groqResponse.json();
            if (!groqResponse.ok) throw new Error(`Groq Fallback Error: ${data.error?.message}`);
            analisisText = data.choices[0].message.content;
        } else {
            throw err; // Si no hay Groq o es otro error, lanzamos el original
        }
      }
    }

    if (!analisisText) {
        throw new Error("El modelo de IA devolvió una respuesta vacía.");
    }

    res.json({ analisis: analisisText });
  } catch (error) {
    if (error.message && (error.message.includes('Groq') || error.message.includes('404'))) {
      console.error("❌ ERROR GEMINI: Modelo no encontrado. Verifica tu API Key en .env");
    } else if (error.message && (error.message.includes('403') || error.message.includes('SERVICE_DISABLED'))) {
      console.error("❌ ERROR GEMINI: API no habilitada. Ve a la consola de Google Cloud y habilita 'Generative Language API'.");
    } else {
      console.error('Error Gemini:', error);
    }
    res.status(500).json({ error: 'Error analizando con IA' });
  }
});

// C. Actualizar Pagos (Cuando detectas el comprobante)
app.post('/api/pagos/:id', async (req, res) => {
  const { id } = req.params;
  const { monto_pagado } = req.body;

  let client;
  try {
    client = await pool.connect();
    // Sumar al monto existente
    const query = `
      UPDATE clientes 
      SET monto_pagado = monto_pagado + $1 
      WHERE id = $2 
      RETURNING *
    `;
    const result = await client.query(query, [monto_pagado, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando pago' });
  } finally {
    if (client) client.release();
  }
});

// C.2 Agendar Seguimiento (Nuevo Endpoint)
app.post('/api/clientes/:id/agendar', async (req, res) => {
  const { id } = req.params;
  const { fecha } = req.body; // Espera formato YYYY-MM-DD o ISO

  let client;
  try {
    client = await pool.connect();
    const query = `
      UPDATE clientes 
      SET fecha_seguimiento = $1 
      WHERE id = $2 
      RETURNING *
    `;
    const result = await client.query(query, [fecha, id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al agendar seguimiento:', err);
    res.status(500).json({ error: 'Error al agendar seguimiento' });
  } finally {
    if (client) client.release();
  }
});

// D. Verificar Estado IA (Semáforo)
app.get('/api/status/ai', async (req, res) => {
  try {
    const modelToUse = req.query.model || MODEL_NAME;

    if (modelToUse.startsWith('openrouter-')) {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }
        });
        if (!response.ok) {
            throw new Error(`OpenRouter Check Failed`);
        }
    } else if (modelToUse.startsWith('groq-')) {
        const groqResponse = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
        });
        if (!groqResponse.ok) {
            const errorData = await groqResponse.json();
            throw new Error(`Groq: ${errorData.error.message}`);
        }
    } else {
        const model = genAI.getGenerativeModel({ model: modelToUse });
        // Generar un token simple para verificar conectividad real
        await model.generateContent("ping"); 
    }

    res.json({ status: 'ok' });
  } catch (error) {
    if (error.message && (error.message.includes('403') || error.message.includes('SERVICE_DISABLED'))) {
      console.error("❌ ERROR GEMINI: API no habilitada. Habilítala en Google Cloud Console.");
    } else {
      console.error("❌ AI Check Failed:", error.message);
    }
    res.status(500).json({ status: 'error' });
  }
});

// E. Verificar Estado de Sitio Web (Ping Real)
app.post('/api/check-site', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ status: 'error' });

  // Asegurar protocolo
  if (!url.startsWith('http')) url = 'https://' + url;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);

    res.json({ status: response.ok ? 'online' : 'offline', code: response.status });
  } catch (error) {
    res.json({ status: 'offline', error: 'unreachable' });
  }
});

// F. Recibir datos de la Encuesta
app.post('/api/encuesta', async (req, res) => {
  const { cliente_id, ...formData } = req.body;
  
  console.log(`📝 [Encuesta] Recibida para ID: ${cliente_id}`);
  console.log(`📦 [Encuesta] Datos:`, JSON.stringify(formData));

  if (!cliente_id) {
    return res.status(400).send('<h1>Error: Falta el ID del cliente.</h1>');
  }

  let client;
  try {
    client = await pool.connect();
    
    // Estructuramos las respuestas específicas de la web para que el Admin las lea fácil
    const respuestasWeb = {
        objetivo: formData.objetivo,
        publico: formData.publico,
        referentes: formData.referentes,
        estilo: formData.estilo,
        secciones: formData.secciones,
        funcionalidades: formData.funcionalidades,
        tono: formData.tono
    };

    // Preparamos el objeto a guardar (mezclando datos de contacto y respuestas web)
    const datosParaGuardar = { 
        ...formData, 
        respuestas_web: respuestasWeb,
        fecha_encuesta: new Date().toISOString() // Guardamos cuándo se llenó
    };

    const query = `
      UPDATE clientes
      SET encuesta_data = COALESCE(encuesta_data, '{}'::jsonb) || $1
      WHERE id = $2
    `;
    const result = await client.query(query, [datosParaGuardar, cliente_id]);
    
    if (result.rowCount === 0) {
        console.warn(`⚠️ [Encuesta] Cliente ID ${cliente_id} no encontrado en DB.`);
        return res.status(404).send('<h1>Error: Cliente no encontrado. Verifica el ID.</h1>');
    }
    
    console.log(`✅ [Encuesta] Guardada exitosamente para ID ${cliente_id}`);
    // Mensaje de éxito para el cliente
    res.send('<div style="font-family: sans-serif; text-align: center; padding-top: 50px;"><h1>¡Gracias! Tu respuesta ha sido guardada.</h1><p>Ya puedes cerrar esta ventana.</p></div>');
  } catch (err) {
    console.error('Error guardando encuesta:', err);
    res.status(500).send('<h1>Error al guardar tu respuesta. Por favor, contacta a soporte.</h1>');
  } finally {
    if (client) client.release();
  }
});

// --- MÓDULO AEXON LEADGEN (Prospección B2B) ---

// Función de Limpieza Estricta (Regex)
function limpiarDatosContacto(textoSucio) {
    const resultados = {
        emails: [],
        telefonos: []
    };

    if (!textoSucio) return resultados;

    // 1. Regex para Emails: Busca patrones estándar
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailsEncontrados = textoSucio.match(emailRegex) || [];
    resultados.emails = [...new Set(emailsEncontrados)]; // Eliminar duplicados

    // 2. Regex para Teléfonos Chilenos (+569XXXXXXXX)
    // Acepta: +56 9 1234 5678, 912345678, 569 1234 5678
    const phoneRegex = /(?:\+?56)?\s?(9)\s?(\d{4})\s?(\d{4})/g;
    let match;
    const telefonosSet = new Set();

    while ((match = phoneRegex.exec(textoSucio)) !== null) {
        // Normalizamos todo a formato +569XXXXXXXX
        const numeroLimpio = `+56${match[1]}${match[2]}${match[3]}`;
        telefonosSet.add(numeroLimpio);
    }
    resultados.telefonos = Array.from(telefonosSet);

    return resultados;
}

// Endpoint: Generar Leads desde Texto/IA
app.post('/api/generar-leads', async (req, res) => {
    const { nicho, instruccion } = req.body;

    if (!nicho) return res.status(400).json({ error: 'El campo nicho es obligatorio.' });

    try {
        // 1. Usamos la IA configurada (Gemini) para simular/buscar la data cruda
        const prompt = `Actúa como un motor de búsqueda de leads B2B.
        Nicho: "${nicho}". Instrucción: "${instruccion}".
        Genera un texto extenso y desordenado que simule resultados de búsqueda web, incluyendo descripciones de empresas, correos electrónicos y números de teléfono chilenos (+569) dispersos en el texto.
        Asegúrate de incluir al menos 5 prospectos con datos de contacto variados.`;

        const model = genAI.getGenerativeModel({ model: MODEL_NAME });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const rawText = response.text();

        // 2. Pasamos el texto por el filtro de limpieza (Regex)
        const datosLimpios = limpiarDatosContacto(rawText);

        res.json({
            status: 'success',
            meta: { nicho, timestamp: new Date() },
            data: datosLimpios,
            raw_preview: rawText.substring(0, 150) + '...' // Para debug
        });

    } catch (error) {
        console.error('❌ Error en AexonLeadGen:', error);
        res.status(500).json({ error: 'Error generando leads.' });
    }
});

// --- AEXON LEADGEN PRO (NUEVOS ENDPOINTS) ---

// Función: Verificación de Dominio de Correo (DNS)
function verificarDominioEmail(email) {
    return new Promise((resolve) => {
        if (!email || !email.includes('@')) return resolve(false);
        const dominio = email.split('@')[1];
        
        // Filtro de dominios falsos comunes
        if (['ejemplo.com', 'example.com', 'correo.com', 'email.com'].includes(dominio.toLowerCase())) {
            return resolve(false);
        }

        dns.resolveMx(dominio, (err, addresses) => {
            resolve(!err && addresses && addresses.length > 0);
        });
    });
}

// Función: Auditor de Calidad de WhatsApp (Anti-Alucinaciones)
function auditarNumeroWhatsapp(telefono) {
    if (!telefono) return { valido: false, motivo: "Sin teléfono" };

    // 1. Limpieza y Formato Base
    // Deja solo números. Ej: +56 9 1234-5678 -> 56912345678
    let limpio = telefono.replace(/\D/g, '');

    // Si viene sin 56 pero tiene 9 dígitos y empieza con 9, agregamos 56
    if (limpio.length === 9 && limpio.startsWith('9')) {
        limpio = '56' + limpio;
    }
    // Si viene con 8 dígitos, asumimos que falta 569 (caso raro pero posible)
    if (limpio.length === 8) {
        limpio = '569' + limpio;
    }

    // 2. Validación de Longitud y Prefijo (Chile: 569 + 8 dígitos = 11 total)
    if (limpio.length !== 11 || !limpio.startsWith('569')) {
        return { valido: false, motivo: "Formato inválido (No es +569...)" };
    }

    // 3. Detección de Patrones Falsos (Alucinaciones de IA)
    const cuerpo = limpio.substring(3); // Los 8 dígitos después del 569

    // A. Números repetidos (Ej: 99999999, 11111111)
    if (/^(\d)\1+$/.test(cuerpo)) return { valido: false, motivo: "Número sospechoso (Dígitos repetidos)" };
    
    // B. Secuencias obvias (Ej: 12345678, 87654321)
    if (cuerpo === '12345678' || cuerpo === '87654321') return { valido: false, motivo: "Número falso (Secuencia 123...)" };
    
    // C. Patrones de relleno (Ej: 90000000)
    if (cuerpo.endsWith('000000')) return { valido: false, motivo: "Número falso (Relleno ceros)" };

    return { valido: true, numero_formateado: '+' + limpio };
}

// 1. Endpoint de Búsqueda y Procesamiento (IA + Regex)
app.post('/api/buscar-leads', async (req, res) => {
    const { nicho, motor, cantidad, instruccion, custom_prompt } = req.body;
    const limit = cantidad || 10;
    const usuarioId = 1;
    
    console.log(`\n🔍 [DEBUG /api/buscar-leads] =========================`);
    console.log(`🔍 [DEBUG] Nicho: ${nicho}`);
    console.log(`🔍 [DEBUG] Motor/Modelo: ${motor}`);
    console.log(`🔍 [DEBUG] Cantidad: ${limit}`);
    console.log(`🔍 [DEBUG] Instrucción: ${instruccion?.substring(0, 100)}...`);
    console.log(`🔍 [DEBUG] KIMI_API_KEY exists: ${!!process.env.KIMI_API_KEY}`);
    console.log(`🔍 [DEBUG] KIMI_API_KEY preview: ${process.env.KIMI_API_KEY ? process.env.KIMI_API_KEY.substring(0, 20) + '...' : 'NO KEY'}`);
    
    if (!nicho && !instruccion) {
        console.log(`🔍 [DEBUG] ERROR: Falta nicho e instrucción`);
        return res.status(400).json({ error: 'Falta el nicho o instrucción' });
    }

    try {
        // 0. OBTENER EXCEPCIONES (Lógica de 6 Meses)
        let excepciones = "";
        let listaNegociosPrevios = [];
        try {
            const prospectosRes = await pool.query("SELECT negocio FROM prospectos WHERE usuario_id = $1 AND created_at > NOW() - INTERVAL '6 months'", [usuarioId]);
            const clientesRes = await pool.query('SELECT negocio FROM clientes');
            listaNegociosPrevios = [...prospectosRes.rows.map(r => r.negocio), ...clientesRes.rows.map(r => r.negocio)];
            excepciones = [...new Set(listaNegociosPrevios)].filter(n => n).join(', ');
            console.log(`🔍 [DEBUG] Excepciones cargadas: ${excepciones.substring(0, 50)}...`);
        } catch (e) { 
            console.warn("🔍 [DEBUG] No se pudieron cargar excepciones:", e.message); 
        }

        const context = instruccion || nicho;
        
        // A. SYSTEM PROMPT AVANZADO
        let promptTemplate = custom_prompt || `Eres un generador de leads B2B. Tu tarea es encontrar {{CANTIDAD}} negocios reales en Chile que coincidan con el siguiente criterio: {{CONTEXTO}}.

REGLAS OBLIGATORIAS:
1. Devuelve SOLO un array JSON válido, sin explicaciones, sin markdown, sin texto adicional
2. Cada objeto debe tener: nombre (string), telefono (string con +569), email (string), rubro (string), direccion (string opcional)
3. Los teléfonos deben ser reales de Chile (+569XXXXXXXX)
4. Los emails deben tener dominios reales (.cl, .com, .cl)
5. NO incluyas estos negocios (ya existen): {{EXCEPCIONES}}

FORMATO DE RESPUESTA (SOLO JSON):
[
  {"nombre": "Nombre Negocio", "telefono": "+56912345678", "email": "contacto@negocio.cl", "rubro": "Tipo de negocio", "direccion": "Dirección"}
]

Genera {{CANTIDAD}} leads ahora.`;
        
        const prompt = promptTemplate
            .replace('{{CONTEXTO}}', context)
            .replace('{{CANTIDAD}}', limit)
            .replace('{{EXCEPCIONES}}', excepciones);
        
        console.log(`🔍 [DEBUG] Prompt generado (primeros 200 chars): ${prompt.substring(0, 200)}...`);
        
        let rawText = "";

        // Función auxiliar para generar texto con fallback
        const generarTexto = async (modelo) => {
            console.log(`🔍 [DEBUG] Intentando modelo: ${modelo}`);
            
            if (modelo && modelo.startsWith('kimi-')) {
                console.log(`🔍 [DEBUG] Detectado KIMI AI, llamando a Moonshot API...`);
                const kimiModel = modelo.replace('kimi-', '');
                console.log(`🔍 [DEBUG] Modelo Kimi limpio: ${kimiModel}`);
                
                const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: prompt }],
                        model: kimiModel || 'moonshot-v1-8k',
                        temperature: 0.7
                    })
                });
                
                console.log(`🔍 [DEBUG] Respuesta Moonshot status: ${response.status}`);
                const data = await response.json();
                
                if (!response.ok) {
                    console.error(`🔍 [DEBUG] ERROR Moonshot:`, JSON.stringify(data, null, 2));
                    throw new Error(data.error?.message || JSON.stringify(data));
                }
                
                console.log(`🔍 [DEBUG] Respuesta Kimi exitosa, contenido (primeros 100 chars): ${data.choices?.[0]?.message?.content?.substring(0, 100)}...`);
                return data.choices[0].message.content;
                
            } else if (modelo && (modelo.startsWith('groq-') || modelo.includes('llama'))) {
                console.log(`🔍 [DEBUG] Detectado GROQ, llamando a Groq API...`);
                const groqModel = modelo.replace('groq-', '');
                
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: prompt }],
                        model: groqModel || 'llama-3.1-8b-instant'
                    })
                });
                
                console.log(`🔍 [DEBUG] Respuesta Groq status: ${response.status}`);
                const data = await response.json();
                
                if (!response.ok) {
                    console.error(`🔍 [DEBUG] ERROR Groq:`, JSON.stringify(data, null, 2));
                    throw new Error(data.error?.message || 'Error Groq');
                }
                return data.choices[0].message.content;
                
            } else {
                console.log(`🔍 [DEBUG] Usando GEMINI con modelo: ${modelo}`);
                const modelToUse = (modelo && !modelo.includes('groq') && !modelo.includes('kimi')) ? modelo : "gemini-2.0-flash";
                const model = genAI.getGenerativeModel({ model: modelToUse });
                const result = await model.generateContent(prompt);
                return result.response.text();
            }
        };

        try {
            // 1. Intento Principal
            console.log(`🔍 [DEBUG] Iniciando intento principal...`);
            rawText = await generarTexto(motor);
            console.log(`🔍 [DEBUG] Intento principal exitoso`);
        } catch (err1) {
            console.error(`🔍 [DEBUG] ERROR en intento principal:`, err1.message);
            console.error(`🔍 [DEBUG] Stack trace:`, err1.stack);
            console.warn(`⚠️ Falló buscar-leads con ${motor || 'default'}. Intentando fallback Groq...`);
            try {
                // 2. Intento Fallback (Groq)
                rawText = await generarTexto('groq-llama-3.1-8b-instant');
            } catch (err2) {
                console.warn(`⚠️ Falló fallback Groq. Intentando Gemini 1.5...`, err2.message);
                // 3. Último Intento (Gemini 1.5)
                rawText = await generarTexto('gemini-1.5-flash');
            }
        }

        // B. PROCESAMIENTO DE DATOS (JSON PARSING)
        const prospectosEncontrados = [];
        let datosIA = null; // Declarar fuera del try para usar en todo el scope
        
        try {
            // Intentar extraer el JSON del texto (por si la IA incluye ```json ... ```)
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            const jsonString = jsonMatch ? jsonMatch[0] : rawText;
            datosIA = JSON.parse(jsonString);

            if (Array.isArray(datosIA)) {
                for (const p of datosIA) {
                    // Validación mínima
                    if (p.nombre && (p.telefono || p.email)) {
                        
                        // AUDITORÍA DE WHATSAPP
                        const auditoria = auditarNumeroWhatsapp(p.telefono);
                        
                        // VERIFICACIÓN DE EMAIL (DNS)
                        const emailValido = await verificarDominioEmail(p.email);
                        
                        // LÓGICA DE FILTRADO FINAL (Backend)
                        
                        // 1. Verificar Duplicado Exacto (Por si la IA ignoró la instrucción)
                        const esDuplicado = listaNegociosPrevios.some(n => n && p.nombre && n.toLowerCase() === p.nombre.toLowerCase());
                        
                        // 2. Definir Estado
                        let estadoFinal = 'VALIDO';
                        if (!auditoria.valido) estadoFinal = 'INVALIDO';
                        if (esDuplicado) estadoFinal = 'DUPLICADO';

                        const prospectoProcesado = {
                            negocio: p.nombre, // Mapeamos nombre persona a campo negocio
                            categoria_nicho: nicho,
                            telefono: auditoria.valido ? auditoria.numero_formateado : null,
                            correo: emailValido ? p.email : null, // Solo guardamos si el dominio existe
                            score_calidad: p.score || 50,
                            segmento: p.segmento || "General",
                            razon: p.razon || "Detectado por IA",
                            estado_whatsapp: estadoFinal,
                            usuario_id: usuarioId
                        };

                        // GUARDADO EN DB (Todos se guardan para historial/auditoría)
                        // Pero en el array 'prospectosEncontrados' (que ve el usuario) SOLO ponemos los VÁLIDOS y NUEVOS.
                        
                        // Guardamos en array temporal para insertar en DB luego
                        p.temp_data = prospectoProcesado; 
                        
                        if (estadoFinal === 'VALIDO') {
                            prospectosEncontrados.push(prospectoProcesado);
                        }
                    }
                }
                
                // C. GUARDADO EN BASE DE DATOS (NEON) - Dentro del try para tener acceso a datosIA
                // Insertamos TODOS (Válidos, Inválidos y Duplicados) para que el sistema aprenda y tenga registro.
                console.log(`[BUSCAR-LEADS] 💾 Guardando ${datosIA.length} registros en la base de datos para auditoría...`);
                for (const rawP of datosIA) {
                    if (rawP.temp_data) {
                        const p = rawP.temp_data;
                        await pool.query(
                            'INSERT INTO prospectos (negocio, categoria_nicho, telefono, correo, score_calidad, segmento, razon_seleccion, estado_whatsapp, usuario_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                            [p.negocio, p.categoria_nicho, p.telefono, p.correo, p.score_calidad, p.segmento, p.razon, p.estado_whatsapp, p.usuario_id]
                        );
                    }
                }
            }
        } catch (e) {
            console.error("Error parseando JSON de IA:", e);
            console.error("Texto crudo recibido de la IA:", rawText.substring(0, 500)); // Log the raw text for debugging
            // Aquí podrías implementar un fallback a regex si fuera necesario
        }

        // D. OBTENER CRÉDITOS DEL USUARIO
        let creditosDisponibles = 0;
        try {
            const creditosResult = await pool.query('SELECT creditos_restantes FROM usuarios WHERE id = $1', [usuarioId]);
            creditosDisponibles = creditosResult.rows[0]?.creditos_restantes || 0;
            console.log(`[CREDITOS] 💳 Usuario ${usuarioId} tiene ${creditosDisponibles} créditos disponibles.`);
        } catch (e) {
            console.warn(`[CREDITOS] ⚠️ No se pudieron obtener créditos, usando 0:`, e.message);
            creditosDisponibles = 0;
        }

        // E. DEDUCIR CRÉDITOS
        const creditosAConsumir = Math.min(prospectosEncontrados.length, creditosDisponibles);
        if (creditosAConsumir > 0) {
            await pool.query(
                'UPDATE usuarios SET creditos_restantes = creditos_restantes - $1 WHERE id = $2',
                [creditosAConsumir, usuarioId]
            );
            console.log(`[CREDITOS] 💳 Se dedujeron ${creditosAConsumir} créditos al usuario ${usuarioId}.`);
        }

        console.log(`[BUSCAR-LEADS] ✔️ Proceso finalizado. Enviando ${prospectosEncontrados.length} leads válidos al cliente.`);
        res.json({
            status: 'success',
            mensaje: `Proceso completado. ${prospectosEncontrados.length} leads válidos entregados. Se consumieron ${creditosAConsumir} créditos.`,
            data: prospectosEncontrados,
            creditos_restantes: creditosDisponibles - creditosAConsumir
        });

    } catch (error) {
        console.error('\n❌ [DEBUG /api/buscar-leads] ERROR CRÍTICO =========================');
        console.error('❌ [DEBUG] Tipo de error:', error.constructor.name);
        console.error('❌ [DEBUG] Mensaje:', error.message);
        console.error('❌ [DEBUG] Stack trace:', error.stack);
        console.error('❌ [DEBUG] ==========================================================\n');
        res.status(500).json({ error: 'Error interno del servidor', detalle: error.message });
    }
});

// 1.5 Endpoint: Auditar Lead con IA (Solicitar devolución de crédito)
app.post('/api/auditar-lead', async (req, res) => {
    const { lead, modelo } = req.body;
    const usuarioId = 1;
    
    if (!lead || !lead.telefono) {
        return res.status(400).json({ error: 'Faltan datos del lead para auditar' });
    }
    
    console.log(`\n🔍 [AUDITORÍA] =========================`);
    console.log(`🔍 [AUDITORÍA] Iniciando auditoría de lead: ${lead.negocio} (${lead.telefono})`);
    
    try {
        // 1. Verificar si ya está en blacklist
        const existeBlacklist = await pool.query(
            'SELECT id FROM blacklist WHERE telefono = $1',
            [lead.telefono]
        );
        
        if (existeBlacklist.rows.length > 0) {
            console.log(`🔍 [AUDITORÍA] Lead ya existe en blacklist`);
            return res.json({
                valido: false,
                mensaje: 'Este número ya fue auditado previamente y marcado como inválido.',
                razon: 'Número previamente auditado',
                accion: 'blacklist_existente'
            });
        }
        
        // 2. VALIDACIÓN LOCAL ESTRICTA (antes de llamar a IA)
        // Esto invalida inmediatamente casos obvios sin gastar tokens de IA
        const telefono = lead.telefono || '';
        const cuerpo = telefono.replace(/\D/g, '');
        const numero9digitos = cuerpo.slice(-9);
        
        // 2.1 Patrones de números inválidos
        const patronesInvalidos = [
            { regex: /^(\d)\1{8}$/, razon: 'Número inválido: todos los dígitos son idénticos' },
            { regex: /^(\d)\1{6,}$/, razon: 'Número sospechoso: 7+ dígitos repetidos seguidos' },
            { regex: /01234567|12345678|23456789/, razon: 'Número sospechoso: secuencia ascendente obvia' },
            { regex: /98765432|87654321|76543210/, razon: 'Número sospechoso: secuencia descendente obvia' },
            { regex: /0000000|1111111|2222222|3333333|4444444|5555555|6666666|7777777|8888888/, razon: 'Número sospechoso: patrón de relleno detectado' }
        ];
        
        for (const patron of patronesInvalidos) {
            if (patron.regex.test(numero9digitos)) {
                console.log(`🔍 [AUDITORÍA] INVALIDADO LOCALMENTE: ${patron.razon}`);
                
                // Agregar a blacklist automáticamente
                await pool.query(
                    `INSERT INTO blacklist (telefono, negocio, razon, modelo, usuario_id) 
                     VALUES ($1, $2, $3, $4, $5) 
                     ON CONFLICT (telefono) DO NOTHING`,
                    [lead.telefono, lead.negocio, patron.razon, 'validacion-local', usuarioId]
                );
                
                // Devolver crédito
                await pool.query(
                    'UPDATE usuarios SET creditos_restantes = creditos_restantes + 1 WHERE id = $1',
                    [usuarioId]
                );
                
                // Actualizar estado
                await pool.query(
                    "UPDATE prospectos SET estado_whatsapp = 'INVALIDO' WHERE telefono = $1",
                    [lead.telefono]
                );
                
                return res.json({
                    valido: false,
                    mensaje: `Lead INVALIDADO: ${patron.razon}`,
                    razon: patron.razon + ` (${telefono})`,
                    confianza: 98,
                    accion: 'credito_devuelto',
                    credito_devuelto: true,
                    metodo: 'validacion-local-strict'
                });
            }
        }
        
        // 2.2 Email obviamente falso
        const correo = (lead.correo || '').toLowerCase();
        const emailsInvalidos = ['test@', 'prueba@', 'demo@', 'fake@', 'ejemplo@', 'test@test.com', 'admin@admin'];
        if (correo && emailsInvalidos.some(e => correo.includes(e))) {
            const razon = `Email claramente de prueba: ${lead.correo}`;
            console.log(`🔍 [AUDITORÍA] INVALIDADO LOCALMENTE: ${razon}`);
            
            await pool.query(
                `INSERT INTO blacklist (telefono, negocio, razon, modelo, usuario_id) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (telefono) DO NOTHING`,
                [lead.telefono, lead.negocio, razon, 'validacion-local', usuarioId]
            );
            await pool.query('UPDATE usuarios SET creditos_restantes = creditos_restantes + 1 WHERE id = $1', [usuarioId]);
            await pool.query("UPDATE prospectos SET estado_whatsapp = 'INVALIDO' WHERE telefono = $1", [lead.telefono]);
            
            return res.json({
                valido: false,
                mensaje: `Lead INVALIDADO: ${razon}`,
                razon: razon,
                confianza: 95,
                accion: 'credito_devuelto',
                credito_devuelto: true,
                metodo: 'validacion-local-email'
            });
        }
        
        // 2.3 Nombre de negocio obviamente falso
        const negocioLower = (lead.negocio || '').toLowerCase();
        const nombresInvalidos = ['test', 'prueba ', 'demo ', 'ejemplo', 'fake ', 'falso '];
        if (nombresInvalidos.some(n => negocioLower.includes(n))) {
            const razon = `Nombre de negocio claramente de prueba: ${lead.negocio}`;
            console.log(`🔍 [AUDITORÍA] INVALIDADO LOCALMENTE: ${razon}`);
            
            await pool.query(
                `INSERT INTO blacklist (telefono, negocio, razon, modelo, usuario_id) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (telefono) DO NOTHING`,
                [lead.telefono, lead.negocio, razon, 'validacion-local', usuarioId]
            );
            await pool.query('UPDATE usuarios SET creditos_restantes = creditos_restantes + 1 WHERE id = $1', [usuarioId]);
            await pool.query("UPDATE prospectos SET estado_whatsapp = 'INVALIDO' WHERE telefono = $1", [lead.telefono]);
            
            return res.json({
                valido: false,
                mensaje: `Lead INVALIDADO: ${razon}`,
                razon: razon,
                confianza: 95,
                accion: 'credito_devuelto',
                credito_devuelto: true,
                metodo: 'validacion-local-nombre'
            });
        }
        
        // 3. Preparar prompt de auditoría para la IA (solo si pasó validaciones locales)
        const promptAuditoria = `Eres un auditor ESTRICTO de calidad de leads B2B. Tu trabajo es detectar CUALQUIER señal de datos falsos o de prueba.

DATOS DEL LEAD A AUDITAR:
- Nombre del negocio: ${lead.negocio}
- Teléfono: ${lead.telefono}
- Email: ${lead.correo || 'No proporcionado'}
- Rubro: ${lead.categoria_nicho || 'No especificado'}

⚠️ REGLAS ESTRICTAS - Marca como INVALIDO si detectas CUALQUIERA de estas señales:

1. TELÉFONO SOSPECHOSO (ALTA PRIORIDAD):
   - Mismo dígito repetido 4+ veces seguidas (ej: +56999999999, +56911111111)
   - Secuencias consecutivas (ej: +56912345678, +56987654321)
   - Patrones de relleno (ej: +56900000000, +56900001234)
   - Longitud incorrecta para Chile (debe ser +569XXXXXXXX = 12 caracteres)

2. EMAIL SOSPECHOSO:
   - Dominios genéricos de ejemplo (ejemplo@correo.com, test@test.com, admin@admin.com)
   - Nombres como "test", "prueba", "ejemplo", "demo", "fake"
   - Sin @ o dominio inválido

3. NOMBRE DE NEGOCIO SOSPECHOSO:
   - Palabras como "Prueba", "Test", "Ejemplo", "Demo", "Falso", "Fake"
   - Solo números o caracteres aleatorios
   - Nombres genéricos sin identidad real ("Negocio", "Empresa XYZ", "Local")

4. COMBINACIÓN SOSPECHOSA:
   - Teléfono + email + nombre todos parecen de prueba
   - Datos que parecen generados automáticamente

📋 FORMATO DE RESPUESTA (JSON obligatorio):
{
    "valido": false,  // false si detectas CUALQUIER problema, true solo si todo parece 100% real
    "razon": "Explicación específica del problema detectado o confirmación de validez",
    "confianza": 95,  // 0-100, más alta si estás seguro de la invalidación
    "recomendacion": "blacklist"  // "blacklist" si es inválido, "valido" si es bueno
}

🔴 IMPORTANTE: Sé MUY EXIGENTE. Es mejor rechazar un lead dudoso que aceptar uno falso. Si tienes DUDAS, marca como INVALIDO.

Responde ÚNICAMENTE con el JSON, sin texto adicional.`;

        // 3. Llamar a la IA para evaluar
        console.log(`🔍 [AUDITORÍA] Consultando a IA (${modelo || 'gemini-2.0-flash'})...`);
        
        let evaluacionIA;
        let modeloUsado = modelo || 'gemini-2.0-flash';
        
        try {
            if (modeloUsado.startsWith('kimi-')) {
                const kimiModel = modeloUsado.replace('kimi-', '');
                const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: promptAuditoria }],
                        model: kimiModel || 'moonshot-v1-8k',
                        temperature: 0.3
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message);
                evaluacionIA = data.choices[0].message.content;
            } else if (modeloUsado.startsWith('groq-')) {
                const groqModel = modeloUsado.replace('groq-', '');
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: promptAuditoria }],
                        model: groqModel || 'llama-3.1-8b-instant'
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message);
                evaluacionIA = data.choices[0].message.content;
            } else {
                const model = genAI.getGenerativeModel({ model: modeloUsado });
                const result = await model.generateContent(promptAuditoria);
                evaluacionIA = result.response.text();
            }
            
            console.log(`🔍 [AUDITORÍA] Respuesta IA recibida`);
        } catch (iaError) {
            console.error(`🔍 [AUDITORÍA] Error llamando a IA:`, iaError.message);
            // Fallback: usar reglas locales
            evaluacionIA = generarEvaluacionLocal(lead);
        }
        
        // 4. Parsear respuesta de IA
        let resultadoAuditoria;
        try {
            const jsonMatch = evaluacionIA.match(/\{[\s\S]*\}/);
            resultadoAuditoria = JSON.parse(jsonMatch ? jsonMatch[0] : evaluacionIA);
        } catch (parseError) {
            console.error(`🔍 [AUDITORÍA] Error parseando respuesta IA:`, parseError.message);
            resultadoAuditoria = {
                valido: true,
                razon: 'No se pudo evaluar con IA. Se asume válido por defecto.',
                confianza: 50,
                recomendacion: 'Verificar manualmente'
            };
        }
        
        // 5. Si es inválido, agregar a blacklist y devolver crédito
        if (!resultadoAuditoria.valido) {
            console.log(`🔍 [AUDITORÍA] Lead marcado como INVÁLIDO`);
            
            // Agregar a blacklist
            await pool.query(
                `INSERT INTO blacklist (telefono, negocio, razon, modelo, usuario_id) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (telefono) DO NOTHING`,
                [lead.telefono, lead.negocio, resultadoAuditoria.razon, modeloUsado, usuarioId]
            );
            
            // Devolver crédito al usuario
            await pool.query(
                'UPDATE usuarios SET creditos_restantes = creditos_restantes + 1 WHERE id = $1',
                [usuarioId]
            );
            
            // Actualizar estado del prospecto en la base de datos
            await pool.query(
                "UPDATE prospectos SET estado_whatsapp = 'INVALIDO' WHERE telefono = $1",
                [lead.telefono]
            );
            
            console.log(`🔍 [AUDITORÍA] ✅ Crédito devuelto y lead agregado a blacklist`);
            
            return res.json({
                valido: false,
                mensaje: `Auditoría completada. El lead fue marcado como INVÁLIDO: ${resultadoAuditoria.razon}`,
                razon: resultadoAuditoria.razon,
                confianza: resultadoAuditoria.confianza,
                recomendacion: resultadoAuditoria.recomendacion,
                accion: 'credito_devuelto',
                credito_devuelto: true
            });
        }
        
        // 6. Si es válido
        console.log(`🔍 [AUDITORÍA] Lead marcado como VÁLIDO`);
        return res.json({
            valido: true,
            mensaje: `Auditoría completada. El lead es VÁLIDO: ${resultadoAuditoria.razon}`,
            razon: resultadoAuditoria.razon,
            confianza: resultadoAuditoria.confianza,
            recomendacion: resultadoAuditoria.recomendacion,
            accion: 'confirmado_valido',
            credito_devuelto: false
        });
        
    } catch (error) {
        console.error('\n❌ [AUDITORÍA] ERROR:', error.message);
        res.status(500).json({ error: 'Error en auditoría', detalle: error.message });
    }
});

// Función auxiliar para evaluación local (fallback si falla la IA)
function generarEvaluacionLocal(lead) {
    const telefono = lead.telefono || '';
    const cuerpo = telefono.replace(/\D/g, '');
    const numero9digitos = cuerpo.slice(-9); // Últimos 9 dígitos
    
    // 1. PATRONES DE NÚMEROS INVÁLIDOS (CHILE)
    
    // Todos los dígitos iguales
    if (/^(\d)\1{8}$/.test(numero9digitos)) {
        return {
            valido: false,
            razon: `Número inválido: todos los dígitos son idénticos (${telefono})`,
            confianza: 98,
            recomendacion: 'blacklist'
        };
    }
    
    // 4+ dígitos consecutivos iguales
    if (/(\d)\1{3,}/.test(numero9digitos)) {
        return {
            valido: false,
            razon: `Número sospechoso: dígitos repetitivos detectados (${telefono})`,
            confianza: 95,
            recomendacion: 'blacklist'
        };
    }
    
    // Secuencias consecutivas ascendentes
    if (/123456|234567|345678|456789|012345/.test(numero9digitos)) {
        return {
            valido: false,
            razon: `Número sospechoso: secuencia ascendente obvia (${telefono})`,
            confianza: 95,
            recomendacion: 'blacklist'
        };
    }
    
    // Secuencias consecutivas descendentes
    if (/987654|876543|765432|654321/.test(numero9digitos)) {
        return {
            valido: false,
            razon: `Número sospechoso: secuencia descendente obvia (${telefono})`,
            confianza: 95,
            recomendacion: 'blacklist'
        };
    }
    
    // Patrones de relleno (terminan en muchos ceros)
    if (/00000$|000000$/.test(numero9digitos)) {
        return {
            valido: false,
            razon: `Número sospechoso: patrón de relleno detectado (${telefono})`,
            confianza: 92,
            recomendacion: 'blacklist'
        };
    }
    
    // 2. EMAILS INVÁLIDOS/GENÉRICOS
    const emailInvalidos = [
        'ejemplo', 'test@', 'prueba@', 'demo@', 'fake@', 
        '@test.com', '@correo.com', '@email.com', '@ejemplo.com',
        'admin@admin', 'user@user', 'nombre@nombre'
    ];
    const correo = (lead.correo || '').toLowerCase();
    if (correo && emailInvalidos.some(e => correo.includes(e.replace('@', '')))) {
        return {
            valido: false,
            razon: `Email genérico o de prueba detectado (${lead.correo})`,
            confianza: 90,
            recomendacion: 'blacklist'
        };
    }
    
    // 3. NOMBRES DE NEGOCIO SOSPECHOSOS
    const nombresInvalidos = ['test', 'prueba', 'demo', 'ejemplo', 'fake', 'falso'];
    const negocioLower = (lead.negocio || '').toLowerCase();
    if (nombresInvalidos.some(n => negocioLower.includes(n))) {
        return {
            valido: false,
            razon: `Nombre de negocio claramente de prueba (${lead.negocio})`,
            confianza: 95,
            recomendacion: 'blacklist'
        };
    }
    
    // Nombres genéricos sin identidad
    const nombresGenericos = ['mi negocio', 'empresa ', 'local ', 'negocio ', 'sin nombre'];
    if (nombresGenericos.some(n => negocioLower.includes(n))) {
        return {
            valido: false,
            razon: `Nombre de negocio demasiado genérico (${lead.negocio})`,
            confianza: 75,
            recomendacion: 'Verificar manualmente'
        };
    }
    
    // 4. VALIDACIÓN BÁSICA DE TELÉFONO CHILENO
    // Debe tener formato +569XXXXXXXX (12 caracteres con +, 11 sin +)
    if (!/^\+569\d{8}$/.test(telefono) && !/^569\d{8}$/.test(telefono) && !/^9\d{8}$/.test(cuerpo.slice(-9))) {
        return {
            valido: false,
            razon: `Formato de teléfono chileno inválido (${telefono})`,
            confianza: 85,
            recomendacion: 'Verificar manualmente'
        };
    }
    
    // Si pasa todas las validaciones
    return {
        valido: true,
        razon: 'Datos verificados: no se detectaron patrones sospechosos.',
        confianza: 80,
        recomendacion: 'valido'
    };
}

// 2. Endpoint para Leer Base de Datos
app.get('/api/prospectos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM prospectos ORDER BY created_at DESC LIMIT 1000');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error obteniendo prospectos' });
    }
});

// 2.5 Endpoint: Obtener Blacklist compartida
app.get('/api/blacklist', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM blacklist ORDER BY created_at DESC LIMIT 1000');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error obteniendo blacklist' });
    }
});

// 3. Endpoint: Sugerir Nichos con IA (Wizard)
app.post('/api/sugerir-nichos', async (req, res) => {
    const { rol, model: modelName } = req.body;
    if (!rol) return res.status(400).json({ error: 'Falta el rol del usuario' });

    try {
        const prompt = `Eres Vicente, estratega senior de Aexon LeadGen. El cliente quiere vender: "${rol}".

Tu misión: Diseñar 3 Estrategias de Prospección (Playbooks) COMPLETAMENTE DIFERENTES entre sí.

🎯 REGLAS PARA LAS 3 ESTRATEGIAS:
1. ESTRATEGIA 1 (Conservadora): Nicho amplio, fácil de encontrar, demanda estable
2. ESTRATEGIA 2 (Intermedia): Nicho específico, menos competencia, mejor margen  
3. ESTRATEGIA 3 (Agresiva): Nicho hiper-especializado, pocos leads pero alta conversión

Las 3 deben ser opciones REALES que el cliente pueda elegir según su estilo de venta.

📋 CONTENIDO DE CADA ESTRATEGIA:
- titulo_nicho: Nombre específico y atractivo del segmento
- senal_de_compra: Evento/disparador que indica que necesitan la solución AHORA (ej: "Acaban de abrir local", "Publicaron que buscan proveedor")
- instruccion_scraper_ia: Instrucción DETALLADA para buscar en Google Maps, Instagram y Facebook. Incluye palabras clave específicas, hashtags, ubicaciones
- hashtags_instagram: 5 hashtags reales y específicos para encontrar estos negocios
- rompehielos_whatsapp: Mensaje de 15-25 palabras, personalizado para este nicho. Debe mencionar el DOLOR específico + la SOLUCIÓN. Tono: profesional cercano, chileno moderado.
- icon: Icono FontAwesome 6 que represente el nicho

💡 EJEMPLO DE ROMPEHIELOS BUENO:
"Hola [Nombre], vi que tienes clínica veterinaria en Providencia. Muchos dueños buscan veterinarios online y no te encuentran. ¿Te interesa que te ayude a aparecer cuando te busquen?"

❌ EJEMPLOS MALOS (NO HACER):
- "Hola, te vendo páginas web" (genérico)
- "Espero que estés bien..." (perder tiempo en formalidades)
- "Soy el mejor desarrollador..." (ego, no empatía)

🚀 IMPORTANTE: Las 3 estrategias deben sentirse como opciones REALES que el cliente puede elegir. Que se sientan tentado a probarlas.
        
Salida OBLIGATORIA en JSON puro:
{
    "playbooks": [
        { "titulo_nicho": "...", "senal_de_compra": "...", "instruccion_scraper_ia": "...", "hashtags_instagram": ["..."], "rompehielos_whatsapp": "...", "icon": "..." },
        { "titulo_nicho": "...", "senal_de_compra": "...", "instruccion_scraper_ia": "...", "hashtags_instagram": ["..."], "rompehielos_whatsapp": "...", "icon": "..." },
        { "titulo_nicho": "...", "senal_de_compra": "...", "instruccion_scraper_ia": "...", "hashtags_instagram": ["..."], "rompehielos_whatsapp": "...", "icon": "..." }
    ]
}`;

        // Función auxiliar para intentar generar con reintentos
        const generarConModelo = async (modelo) => {
            let responseText = "";
            if (modelo && (modelo.startsWith('groq-') || modelo.includes('llama'))) {
                const groqModel = modelo.replace('groq-', '');
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: prompt }],
                        model: groqModel || 'llama-3.1-8b-instant',
                        response_format: { type: "json_object" }
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || 'Error Groq');
                responseText = data.choices[0].message.content;
            } else {
                const modelToUse = (modelo && !modelo.includes('groq')) ? modelo : MODEL_NAME;
                const model = genAI.getGenerativeModel({ model: modelToUse });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                responseText = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            }
            return responseText;
        };

        let text = "";
        try {
            // 1. Intento Principal
            text = await generarConModelo(modelName || MODEL_NAME);
        } catch (err1) {
            console.warn(`⚠️ Falló sugerir-nichos con ${modelName}. Intentando fallback Groq...`, err1.message);
            try {
                // 2. Intento Fallback (Groq)
                text = await generarConModelo('groq-llama-3.1-8b-instant');
            } catch (err2) {
                console.warn(`⚠️ Falló fallback Groq. Intentando Gemini 1.5...`, err2.message);
                // 3. Último Intento (Gemini 1.5)
                text = await generarConModelo('gemini-1.5-flash');
            }
        }

        res.json(JSON.parse(text));
    } catch (error) {
        console.error('Error en sugerir-nichos:', error);
        // Fallback en caso de error de IA
        res.json({
            playbooks: [
                { titulo_nicho: "Empresas de Servicios", senal_de_compra: "Alta demanda general", instruccion_scraper_ia: "Buscar servicios en maps", rompehielos_whatsapp: "Hola, vi tu servicio...", icon: "fa-solid fa-briefcase" },
                { titulo_nicho: "Comercio Minorista", senal_de_compra: "Volumen alto", instruccion_scraper_ia: "Buscar retail", rompehielos_whatsapp: "Hola, tienes stock...", icon: "fa-solid fa-shop" },
                { titulo_nicho: "Profesionales Salud", senal_de_compra: "Poder adquisitivo", instruccion_scraper_ia: "Buscar doctores", rompehielos_whatsapp: "Hola doctor...", icon: "fa-solid fa-user-doctor" }
            ]
        });
    }
});

// 3.1 Endpoint: Listar Estrategias Guardadas (Para el Buscador)
app.get('/api/plantillas', async (req, res) => {
    try {
        // Traemos las plantillas ordenadas por la más reciente
        const result = await pool.query('SELECT id, nombre_plantilla, rol_usuario, playbook_data FROM plantillas_guardadas ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo plantillas:', error);
        res.status(500).json({ error: 'Error al cargar estrategias' });
    }
});

// 3.2 Endpoint: Actualizar Plantilla (Para Entrenar Modelos)
app.put('/api/plantillas/:id', async (req, res) => {
    const { id } = req.params;
    const { playbook_data } = req.body;

    try {
        const query = `
            UPDATE plantillas_guardadas
            SET playbook_data = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await pool.query(query, [playbook_data, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Plantilla no encontrada' });
        }

        res.json({ status: 'success', data: result.rows[0] });
    } catch (error) {
        console.error('Error actualizando plantilla:', error);
        res.status(500).json({ error: 'Error al actualizar plantilla' });
    }
});

// 3.5 Endpoint: Chat del Wizard (Entrevista IA)
app.post('/api/wizard/chat', async (req, res) => {
    const { history, model: modelName } = req.body;

    // Análisis profundo del historial
    const historialCompleto = history.map(m => m.content).join(' | ').toLowerCase();
    
    // Detectar qué ya tenemos
    const productosDetectados = [];
    const publicosDetectados = [];
    const ubicacionesDetectadas = [];
    
    // Productos
    if (historialCompleto.includes('seguro')) productosDetectados.push('seguros');
    if (historialCompleto.includes('página web') || historialCompleto.includes('pagina web') || historialCompleto.includes('sitio web')) productosDetectados.push('páginas web');
    if (historialCompleto.includes('consultoría')) productosDetectados.push('consultoría');
    if (historialCompleto.includes('software')) productosDetectados.push('software');
    if (historialCompleto.includes('marketing')) productosDetectados.push('marketing digital');
    
    // Públicos
    if (historialCompleto.includes('pyme')) publicosDetectados.push('pymes');
    if (historialCompleto.includes('doctor') || historialCompleto.includes('médico')) publicosDetectados.push('doctores');
    if (historialCompleto.includes('veterinaria')) publicosDetectados.push('veterinarias');
    if (historialCompleto.includes('logística') || historialCompleto.includes('logistica')) publicosDetectados.push('pymes de logística');
    if (historialCompleto.includes('trabajador')) publicosDetectados.push('trabajadores');
    if (historialCompleto.includes('adulto')) publicosDetectados.push('adultos');
    if (historialCompleto.includes('empresa')) publicosDetectados.push('empresas');
    if (historialCompleto.includes('persona')) publicosDetectados.push('personas');
    
    // Ubicaciones
    if (historialCompleto.includes('santiago')) ubicacionesDetectadas.push('Santiago');
    if (historialCompleto.includes('providencia')) ubicacionesDetectadas.push('Providencia');
    if (historialCompleto.includes('ñuñoa') || historialCompleto.includes('nunoa')) ubicacionesDetectadas.push('Ñuñoa');
    if (historialCompleto.includes('las condes')) ubicacionesDetectadas.push('Las Condes');
    if (historialCompleto.includes('chile') && !historialCompleto.includes('santiago')) ubicacionesDetectadas.push('Chile');
    if (historialCompleto.includes('todo chile') || historialCompleto.includes('nacional')) ubicacionesDetectadas.push('todo Chile');
    
    const tieneProducto = productosDetectados.length > 0;
    const tienePublico = publicosDetectados.length > 0;
    const tieneUbicacion = ubicacionesDetectadas.length > 0;
    const datosCompletos = tieneProducto && tienePublico && tieneUbicacion;

    // Si tenemos los 3 datos, forzar finalización
    if (datosCompletos) {
        const resumen = `Vende ${productosDetectados[0]} a ${publicosDetectados[0]} en ${ubicacionesDetectadas[0]}`;
        return res.json({ 
            ready: true, 
            message: `¡Perfecto! Entendido: ${resumen}. Voy a diseñar 3 estrategias personalizadas para ti. 🚀`, 
            summary: resumen 
        });
    }

    try {
        const prompt = `Eres "Vicente", estratega de ventas de Aexon LeadGen. Tu trabajo es entender el negocio del cliente en 3 datos y NADA MÁS.

DATOS NECESARIOS:
1. PRODUCTO: ¿Qué vende?
2. PÚBLICO: ¿A quién?
3. UBICACIÓN: ¿Dónde?

⚠️ REGLAS ABSOLUTAS:
- Si ya tienes los 3 datos, DICES "Listo" y NADA MÁS
- NO repitas preguntas
- NO pidas clarificación de algo que ya se dijo
- 1 pregunta por mensaje, máximo
- Máximo 15 palabras por respuesta

❌ MALO:
"Ya sabemos que vendes X y a Y, pero ¿dónde están?"

✅ BUENO:
"¿Dónde están esas pymes?"

HISTORIAL:
${history.map(m => `${m.role === 'user' ? 'C' : 'V'}: ${m.content}`).join('\n')}

ESTADO ACTUAL:
- Producto: ${tieneProducto ? productosDetectados[0] : 'FALTA'}
- Público: ${tienePublico ? publicosDetectados[0] : 'FALTA'}
- Ubicación: ${tieneUbicacion ? ubicacionesDetectadas[0] : 'FALTA'}

INSTRUCCIÓN:
Si faltan datos, pregunta SOLO lo que falta, en máximo 15 palabras.
Si están todos los datos, confirma y termina.

JSON:
{ "ready": ${datosCompletos}, "message": "..." }`;        

        // Si faltan datos, usar respuesta predefinida inteligente para evitar errores de IA
        if (!datosCompletos) {
            let mensaje = '';
            
            if (!tieneProducto) {
                mensaje = '¿Qué producto o servicio vendes?';
            } else if (!tienePublico) {
                mensaje = `¿A quién le vendes ${productosDetectados[0]}?`;
            } else if (!tieneUbicacion) {
                mensaje = `¿Dónde están esos ${publicosDetectados[0]}?`;
            }
            
            return res.json({ ready: false, message: mensaje });
        }

        // Si llegamos aquí, debería estar completo pero igual llamamos a la IA
        const aiModel = genAI.getGenerativeModel({ 
            model: modelName || MODEL_NAME,
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const result = await aiModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        
        res.json(JSON.parse(text));
        
    } catch (error) {
        console.error('Error en wizard chat:', error);
        
        // Fallback: respuesta simple según lo que falte
        if (!tieneProducto) {
            res.json({ ready: false, message: '¿Qué vendes?' });
        } else if (!tienePublico) {
            res.json({ ready: false, message: `¿A quién vendes ${productosDetectados[0]}?` });
        } else if (!tieneUbicacion) {
            res.json({ ready: false, message: '¿Dónde están esos clientes?' });
        } else {
            const resumen = `Vende ${productosDetectados[0]} a ${publicosDetectados[0]} en ${ubicacionesDetectadas[0]}`;
            res.json({ ready: true, message: '¡Listo! Voy a preparar tus estrategias. 🚀', summary: resumen });
        }
    }
});

// 4. Endpoint: Guardar Plantilla
app.post('/api/guardar-plantilla', async (req, res) => {
    const { nombre, rol, nicho, filtros, playbook_data } = req.body;
    
    try {
        const query = `
            INSERT INTO plantillas_guardadas (nombre_plantilla, rol_usuario, nicho_objetivo, filtros_json, playbook_data)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `;
        const result = await pool.query(query, [nombre, rol, nicho, filtros, playbook_data]);
        res.json({ status: 'success', id: result.rows[0].id });
    } catch (error) {
        console.error('Error guardando plantilla:', error);
        res.status(500).json({ error: 'Error al guardar plantilla' });
    }
});

// 5. Endpoint: Verificar Suscripción (Sistema de Cobro)
app.get('/api/usuario/estado', async (req, res) => {
    const usuarioId = req.headers['x-user-id'];
    if (!usuarioId) return res.status(401).json({ error: "No autorizado" });

    try {
        const result = await pool.query('SELECT plan_id, creditos_restantes, fecha_renovacion FROM usuarios WHERE id = $1', [usuarioId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const usuario = result.rows[0];
        const planes = {
            1: { nombre: "Gratuito", creditos_totales: 20 },
            2: { nombre: "Piloto", creditos_totales: 350 },
            3: { nombre: "Profesional", creditos_totales: 2000 },
            4: { nombre: "Agencia", creditos_totales: 6000 }
        };

        res.json({
            plan: planes[usuario.plan_id] || { nombre: "Desconocido" },
            creditos_restantes: usuario.creditos_restantes,
            fecha_renovacion: usuario.fecha_renovacion
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error verificando suscripción' });
    }
});

// 6. Endpoint Admin: Recargar Días (Para cobrar)
// Uso: POST /api/admin/asignar-plan { "usuario_id": 1, "plan_id": 3 }
app.post('/api/admin/asignar-plan', async (req, res) => {
    const { usuario_id, plan_id } = req.body;
    const planes = {
        1: { creditos: 20 },
        2: { creditos: 350 },
        3: { creditos: 2000 },
        4: { creditos: 6000 }
    };

    if (!planes[plan_id]) {
        return res.status(400).json({ error: 'Plan ID inválido.' });
    }

    const creditos = planes[plan_id].creditos;
    const fechaRenovacion = new Date();
    fechaRenovacion.setMonth(fechaRenovacion.getMonth() + 1);

    try {
        await pool.query(
            'UPDATE usuarios SET plan_id = $1, creditos_restantes = $2, fecha_renovacion = $3 WHERE id = $4',
            [plan_id, creditos, fechaRenovacion, usuario_id]
        );
        res.json({ status: 'success', message: `Plan ${plan_id} asignado al usuario ${usuario_id} con ${creditos} créditos.` });
    } catch (error) {
        console.error('Error asignando plan:', error);
        res.status(500).json({ error: 'Error al asignar el plan.' });
    }
});


// --- INICIAR SERVIDOR ---
async function startServer() {
  try {
    // 1. Probar conexión a la base de datos antes de iniciar
    const client = await pool.connect();
    console.log('✅ Base de Datos NEON conectada correctamente.');
    
    // AUTO-FIX: Crear columna faltante si no existe
    try {
      await client.query('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_seguimiento TEXT UNIQUE');
      console.log('🔧 Esquema verificado: Columna "codigo_seguimiento" lista.');
    } catch (e) {
      console.warn('⚠️ No se pudo verificar el esquema:', e.message);
    }
    
    // AUTO-FIX: Crear tabla plantillas_guardadas si no existe (Para el Wizard)
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS plantillas_guardadas (
                id SERIAL PRIMARY KEY,
                nombre_plantilla VARCHAR(255) NOT NULL,
                rol_usuario VARCHAR(255),
                nicho_objetivo VARCHAR(255),
                filtros_json JSONB,
                playbook_data JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        // Asegurar que la columna playbook_data exista (por si la tabla ya existía de antes)
        await client.query('ALTER TABLE plantillas_guardadas ADD COLUMN IF NOT EXISTS playbook_data JSONB');
        console.log('🔧 Esquema verificado: Tabla "plantillas_guardadas" lista.');
    } catch (e) {
        console.warn('⚠️ Error verificando tabla plantillas:', e.message);
    }

    // AUTO-FIX: Crear tabla prospectos si no existe (Para el Buscador)
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS prospectos (
                id SERIAL PRIMARY KEY,
                negocio VARCHAR(255) NOT NULL,
                categoria_nicho VARCHAR(255),
                telefono VARCHAR(20),
                correo VARCHAR(255),
                score_calidad INTEGER DEFAULT 0,
                segmento VARCHAR(100),
                razon_seleccion TEXT,
                estado_whatsapp VARCHAR(50) DEFAULT 'PENDIENTE',
                usuario_id INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        // Asegurar que las columnas existan si la tabla ya fue creada
        await client.query('ALTER TABLE prospectos ADD COLUMN IF NOT EXISTS segmento VARCHAR(100)');
        await client.query('ALTER TABLE prospectos ADD COLUMN IF NOT EXISTS razon_seleccion TEXT');
        await client.query('ALTER TABLE prospectos ADD COLUMN IF NOT EXISTS estado_whatsapp VARCHAR(50) DEFAULT \'PENDIENTE\'');
        await client.query('ALTER TABLE prospectos ADD COLUMN IF NOT EXISTS usuario_id INTEGER DEFAULT 1');
        console.log('🔧 Esquema verificado: Tabla "prospectos" lista.');
    } catch (e) {
        console.warn('⚠️ Error verificando tabla prospectos:', e.message);
    }

    // AUTO-FIX: Crear tabla usuarios y asignar plan de prueba
    try {
        // 1. Crear tabla si no existe (con la estructura mínima para evitar errores)
        await client.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE,
                username VARCHAR(255) UNIQUE,
                password VARCHAR(255),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // 2. Migración de Esquema: Añadir columnas del nuevo modelo de créditos si no existen.
        // Esto asegura que si la tabla ya existía con un esquema antiguo, se actualice.
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plan_id INTEGER DEFAULT 1;');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS creditos_restantes INTEGER DEFAULT 20;');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_renovacion DATE;');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS username VARCHAR(255) UNIQUE;');
        await client.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password VARCHAR(255);');

        // 3. Limpieza: Eliminar la columna del sistema de suscripción antiguo si existe.
        await client.query('ALTER TABLE usuarios DROP COLUMN IF EXISTS suscripcion_hasta;');

        // 4. Crear tabla de blacklist compartida
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS blacklist (
                    id SERIAL PRIMARY KEY,
                    telefono VARCHAR(20) UNIQUE NOT NULL,
                    negocio VARCHAR(255),
                    razon TEXT,
                    modelo VARCHAR(100),
                    usuario_id INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT NOW()
                );
            `);
            console.log('🔧 Esquema verificado: Tabla "blacklist" lista.');
        } catch (e) {
            console.warn('⚠️ Error verificando tabla blacklist:', e.message);
        }

        // 5. Upsert para garantizar tu usuario Admin (ID 1)
        await client.query(`
            INSERT INTO usuarios (id, email, username, password, plan_id, creditos_restantes) 
            VALUES (1, 'admin@tusitioya.cl', 'alexisferrada', '123654', 4, 10000)
            ON CONFLICT (id) DO UPDATE SET username = 'alexisferrada', password = '123654', plan_id = 4, creditos_restantes = 10000;
        `);
        console.log('🎁 Usuario Admin "alexisferrada" configurado con Plan Agencia.');
    } catch (e) {
        console.warn('⚠️ Error configurando usuarios:', e.message);
    }

    client.release();

    // 2. VERIFICAR ESTADO DE APIs DE IA
    await verificarEstadoIAs();

    // 3. Iniciar el servidor Express SOLO en puerto 3000
    const server = app.listen(3000, () => {
        console.log(`✅ Servidor corriendo en http://localhost:3000 | IA: ${MODEL_NAME}`);
        console.log(`📁 Dashboard: http://localhost:3000/dashboard.html`);
        console.log(`🏠 Landing: http://localhost:3000/index.html`);
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error('❌ ERROR: Puerto 3000 está ocupado. Cierra otras ventanas de Node.js y reinicia.');
            console.error('   Ejecuta: taskkill /F /IM node.exe');
            process.exit(1);
        } else {
            console.error('❌ Error al iniciar el servidor:', e);
            process.exit(1);
        }
    });
  } catch (err) {
    console.error('❌ ERROR FATAL: No se pudo conectar a la Base de Datos. El servidor NO se iniciará.');
    console.error(err.stack);
    process.exit(1); // Salir del proceso con un código de error para que sea obvio que falló
  }
}

startServer();