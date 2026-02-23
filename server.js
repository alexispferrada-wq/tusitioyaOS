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

// Ruta de prueba para ver si el servidor vive
app.get('/', (req, res) => {
  // Redirigir a la página principal de la aplicación para una mejor experiencia de usuario.
  res.redirect('/dashboard_NUEVO.html');
});
 
// Fix para móviles: Redirigir rutas sin extensión a la vista correcta
app.get('/previo_comando', (req, res) => {
  res.redirect('/previo_comando.html');
});

app.get('/dashboard_NUEVO', (req, res) => {
  res.redirect('/dashboard_NUEVO.html');
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
    // Lógica de Fallback: Intentar con el modelo seleccionado, si falla, probar otro.
    let modelToUse = modelName || MODEL_NAME;
    let prospectos;
    let errorInicial;

    const intentarGenerar = async (modelo) => {
        if (modelo.startsWith('openrouter-')) {
            const orModel = modelo.replace('openrouter-', '').replace(':free', ''); // Limpiar el sufijo :free
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000', // Requerido por OpenRouter
                    'X-Title': 'TuSitioYa OS'
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    model: orModel,
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(`OpenRouter API Error: ${data.error?.message || JSON.stringify(data)}`);
            
            const text = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '');
            const parsed = JSON.parse(text);
            return Array.isArray(parsed) ? parsed : parsed.prospectos;
        } else if (modelo.startsWith('groq-') || modelo.includes('llama')) {
            const groqModel = modelo.replace('groq-', '');
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    model: groqModel || 'llama-3.1-8b-instant', // Usamos el modelo seleccionado o el default
                    temperature: 0.7,
                    max_tokens: 4096,
                    response_format: { type: "json_object" }
                })
            });
            const data = await groqResponse.json();
            if (!groqResponse.ok) throw new Error(`Groq API Error: ${data.error?.message || 'Unknown'}`);
            const groqContent = JSON.parse(data.choices[0].message.content);
            return groqContent.prospectos;
        } else {
            const aiModel = genAI.getGenerativeModel({ model: modelo }); // Usamos el modelo que viene del HTML
            const result = await aiModel.generateContent(prompt);
            const response = await result.response;
            const text = response.text().replace(/```json/g, '').replace(/```/g, '');
            const parsed = JSON.parse(text);
            return Array.isArray(parsed) ? parsed : parsed.prospectos;
        }
    };

    try {
        prospectos = await intentarGenerar(modelToUse);
    } catch (e) {
        console.warn(`⚠️ Falló el modelo principal (${modelToUse}). Intentando fallback...`, e.message);
        errorInicial = e;
        // Fallback: Si falló Gemini, prueba Groq. Si falló Groq, prueba Gemini.
        try {
            const fallbackModel = modelToUse.includes('gemini') ? 'groq-llama-3.1-8b-instant' : 'gemini-2.0-flash';
            prospectos = await intentarGenerar(fallbackModel);
        } catch (e2) {
            console.warn(`⚠️ Falló el segundo intento. Probando OpenRouter (Gemma 2 Free)...`, e2.message);
            // Tercer intento: OpenRouter (Modelo gratuito de Google)
            try {
                prospectos = await intentarGenerar('openrouter-google/gemma-2-9b-it'); // Usar el ID limpio
            } catch (e3) {
                throw new Error(`Todos los modelos fallaron. Gemini: ${errorInicial.message}. Groq: ${e2.message}. OpenRouter: ${e3.message}`);
            }
        }
    }

    res.json(prospectos);
  } catch (err) {
    if (err.message && err.message.includes('Groq')) {
      console.error("❌ ERROR GROQ:", err.message);
    } else if (err.message && err.message.includes('404')) {
      console.error("❌ ERROR GEMINI: Modelo no encontrado. Verifica tu API Key.");
    } else if (err.message && (err.message.includes('403') || err.message.includes('SERVICE_DISABLED'))) {
      console.error("❌ ERROR GEMINI: API no habilitada. Ve a la consola de Google Cloud y habilita 'Generative Language API'.");
    } else if (err.message && err.message.includes('429')) {
      console.error("⏳ ERROR GEMINI: Cuota excedida (429). Espera unos momentos.");
      return res.status(429).json({ error: 'La IA está saturada. Por favor espera 1 minuto e intenta de nuevo.' });
    } else {
      console.error('❌ Error Inesperado en /api/prospectar:', err);
    }
    res.status(500).json({ error: 'Error generando prospectos' });
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
    const usuarioId = 1; // Por ahora hardcodeado al admin, luego vendrá del login
    
    if (!nicho && !instruccion) return res.status(400).json({ error: 'Falta el nicho o instrucción' });

    try {
        // 0. OBTENER EXCEPCIONES (Lógica de 6 Meses)
        let excepciones = "";
        let listaNegociosPrevios = [];
        try {
            // A. Historial de este usuario en los últimos 6 meses
            const prospectosRes = await pool.query("SELECT negocio FROM prospectos WHERE usuario_id = $1 AND created_at > NOW() - INTERVAL '6 months'", [usuarioId]);
            
            // B. Base de Datos Real (Clientes en Neon)
            const clientesRes = await pool.query('SELECT negocio FROM clientes');

            // Unificar y limpiar
            listaNegociosPrevios = [...prospectosRes.rows.map(r => r.negocio), ...clientesRes.rows.map(r => r.negocio)];
            excepciones = [...new Set(listaNegociosPrevios)].filter(n => n).join(', ');
        } catch (e) { console.warn("No se pudieron cargar excepciones:", e.message); }

        const context = instruccion || nicho;
        
        // A. SYSTEM PROMPT AVANZADO (Nivel Empresarial)
        // Usar el prompt personalizado del frontend si existe, o el default
        let promptTemplate = custom_prompt || `Actúa como un Analista de Inteligencia de Ventas Experto... (Default)`;
        
        // Reemplazar variables dinámicas
        const prompt = promptTemplate
            .replace('{{CONTEXTO}}', context)
            .replace('{{CANTIDAD}}', limit)
            .replace('{{EXCEPCIONES}}', excepciones);
        
        let rawText = "";

        // Función auxiliar para generar texto con fallback
        const generarTexto = async (modelo) => {
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
                        model: groqModel || 'llama-3.1-8b-instant'
                    })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error?.message || 'Error Groq');
                return data.choices[0].message.content;
            } else {
                const modelToUse = (modelo && !modelo.includes('groq')) ? modelo : "gemini-2.0-flash";
                const model = genAI.getGenerativeModel({ model: modelToUse });
                const result = await model.generateContent(prompt);
                return result.response.text();
            }
        };

        try {
            // 1. Intento Principal
            rawText = await generarTexto(motor);
        } catch (err1) {
            console.warn(`⚠️ Falló buscar-leads con ${motor || 'default'}. Intentando fallback Groq...`, err1.message);
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
        
        try {
            // Intentar extraer el JSON del texto (por si la IA incluye ```json ... ```)
            const jsonMatch = rawText.match(/\[[\s\S]*\]/);
            const jsonString = jsonMatch ? jsonMatch[0] : rawText;
            const datosIA = JSON.parse(jsonString);

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
            }
        } catch (e) {
            console.error("Error parseando JSON de IA:", e);
            // Aquí podrías implementar un fallback a regex si fuera necesario
        }

        // C. GUARDADO EN BASE DE DATOS (NEON)
        // Insertamos TODOS (Válidos, Inválidos y Duplicados) para que el sistema aprenda y tenga registro.
        if (Array.isArray(datosIA)) {
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

        res.json({
            status: 'success',
            mensaje: `Proceso completado. ${prospectosEncontrados.length} leads nuevos y válidos entregados.`,
            data: prospectosEncontrados
        });

    } catch (error) {
        console.error('Error en buscar-leads:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

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

// 3. Endpoint: Sugerir Nichos con IA (Wizard)
app.post('/api/sugerir-nichos', async (req, res) => {
    const { rol, model: modelName } = req.body;
    if (!rol) return res.status(400).json({ error: 'Falta el rol del usuario' });

    try {
        const prompt = `Actúa como un Estratega de Crecimiento B2B/B2C Senior.
        El usuario vende: "${rol}".

        Tu misión: Diseñar 3 Estrategias de Prospección (Playbooks) altamente detalladas, profesionales y accionables.
        
        CRÍTICO:
        - Si es B2B: Enfócate en cargos específicos, tamaños de empresa, tecnologías que usan y dolores operativos.
        - Si es B2C: Enfócate en intereses, comportamientos en redes sociales, grupos específicos y momentos de vida.
        - SIEMPRE incluye búsqueda en: Facebook, Google e Instagram.
        
        El tono debe ser profesional pero claro. La "instruccion_scraper_ia" debe ser una orden técnica precisa para un equipo de investigación.
        
        Salida OBLIGATORIA en JSON puro con esta estructura:
        {
            "playbooks": [
                { 
                    "titulo_nicho": "Nombre específico del segmento (Ej: Clínicas Dentales con >3 sucursales)", 
                    "senal_de_compra": "Trigger o evento que indica necesidad inmediata (Ej: Están contratando recepcionistas en LinkedIn, lo que indica saturación).",
                    "instruccion_scraper_ia": "Instrucción técnica detallada. Incluye: Palabras clave exactas, Plataformas (Google Maps, LinkedIn, Instagram), Filtros de exclusión y Criterios de calidad. (Ej: 'Buscar en Google Maps: Dentistas en Providencia. Filtrar por: Tiene sitio web pero no tiene pixel de Facebook. Ignorar cadenas grandes').",
                    "hashtags_instagram": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
                    "rompehielos_whatsapp": "Mensaje de conexión de alto valor. No vendas, aporta valor o haz una pregunta que duela. (Max 2 líneas).",
                    "icon": "fa-solid fa-user-doctor"
                }
            ]
        }
        Usa iconos de FontAwesome (versión 6) para "icon".`;

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
        const result = await pool.query('SELECT id, nombre_plantilla, playbook_data FROM plantillas_guardadas ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error obteniendo plantillas:', error);
        res.status(500).json({ error: 'Error al cargar estrategias' });
    }
});

// 3.5 Endpoint: Chat del Wizard (Entrevista IA)
app.post('/api/wizard/chat', async (req, res) => {
    const { history, model: modelName } = req.body;

    try {
        const prompt = `Actúa como un amigo experto en ventas que está ayudando a un colega.
        Tu objetivo: Entender qué vende tu amigo y a quién (¿Empresas o Personas normales?).
        
        Historial de conversación:
        ${history.map(m => `${m.role === 'user' ? 'Usuario' : 'Tú'}: ${m.content}`).join('\n')}

        Instrucciones de Personalidad:
        - Habla relajado, usa emojis, sé breve. Cero formalismos.
        - No uses palabras raras como "segmento", "target", "scraper". Usa "gente", "clientes", "buscar".
        - Si te falta info, pregunta directo: "¿Pero le vendes a empresas o a gente normal?" o "¿En qué ciudad estás?".
        - Si ya entendiste, di que estás listo.

        FORMATO RESPUESTA OBLIGATORIO (JSON):
        Si faltan datos:
        { "ready": false, "message": "Tu pregunta aquí..." }

        Si tienes los datos suficientes:
        { "ready": true, "message": "¡Listo! Ya te entendí. Voy a armarte 3 planes para conseguir esos clientes. Dame un segundo...", "summary": "Resumen simple (Ej: Vende seguros a papás primerizos)" }
        `;

        // Función auxiliar para intentar con diferentes modelos (Fallback System)
        const intentarModelo = async (modelo) => {
            if (modelo.includes('groq') || modelo.includes('llama')) {
                 // Lógica para Groq (Respaldo Rápido)
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
                return JSON.parse(data.choices[0].message.content);
            } else {
                // Lógica para Gemini (Principal)
                const aiModel = genAI.getGenerativeModel({ 
                    model: modelo,
                    generationConfig: { responseMimeType: "application/json" }
                });
                const result = await aiModel.generateContent(prompt);
                const response = await result.response;
                const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(text);
            }
        };

        let resultado;
        try {
            // 1. Intento Principal (Modelo seleccionado o Default)
            resultado = await intentarModelo(modelName || MODEL_NAME);
        } catch (err1) {
            console.warn(`⚠️ Falló modelo principal (${modelName || MODEL_NAME}). Intentando fallback...`, err1.message);
            try {
                // 2. Intento Fallback (Groq Llama 3)
                if (!process.env.GROQ_API_KEY) throw new Error("No hay API Key de Groq configurada.");
                resultado = await intentarModelo('groq-llama-3.1-8b-instant');
            } catch (err2) {
                console.warn(`⚠️ Falló Groq. Intentando Gemini 1.5 Flash...`, err2.message);
                // 3. Último Intento (Gemini 1.5 Flash - suele ser más estable)
                resultado = await intentarModelo('gemini-1.5-flash');
            }
        }

        res.json(resultado);
    } catch (error) {
        console.error('Error en wizard chat (Todos los modelos fallaron):', error);
        
        let mensajeError = "Tuve un pequeño lapso. ¿Podrías repetirme qué vendes?";
        if (error.message && error.message.includes('429')) {
            mensajeError = "⏳ Todas las IAs están saturadas. Por favor espera 30 segundos e intenta de nuevo.";
        }
        res.json({ ready: false, message: mensajeError });
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
app.get('/api/suscripcion/estado', async (req, res) => {
    // NOTA: En un sistema real, aquí tomarías el ID del usuario logueado.
    // Por ahora, usamos el usuario ID 1 por defecto.
    try {
        const result = await pool.query('SELECT suscripcion_hasta FROM usuarios WHERE id = 1');
        
        if (result.rows.length === 0) {
            return res.json({ activo: false, dias_restantes: 0, mensaje: "Usuario no encontrado" });
        }

        const fechaVencimiento = new Date(result.rows[0].suscripcion_hasta);
        const hoy = new Date();
        const diferenciaTiempo = fechaVencimiento - hoy;
        const diasRestantes = Math.ceil(diferenciaTiempo / (1000 * 60 * 60 * 24));

        if (diasRestantes > 0) {
            res.json({ activo: true, dias_restantes: diasRestantes });
        } else {
            res.json({ activo: false, dias_restantes: 0 });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error verificando suscripción' });
    }
});

// 6. Endpoint Admin: Recargar Días (Para cobrar)
// Uso: POST /api/admin/recargar { "dias": 10 }
app.post('/api/admin/recargar', async (req, res) => {
    const { dias } = req.body;
    // Sumar días a la fecha actual
    await pool.query(`UPDATE usuarios SET suscripcion_hasta = NOW() + INTERVAL '${dias} days' WHERE id = 1`);
    res.json({ status: 'success', mensaje: `Se han agregado ${dias} días de acceso.` });
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

    // AUTO-FIX: Crear tabla usuarios y asignar 100 días de prueba (Solicitado)
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE,
                suscripcion_hasta TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        // Upsert para garantizar 100 días al usuario ID 1
        await client.query(`
            INSERT INTO usuarios (id, email, suscripcion_hasta) 
            VALUES (1, 'admin@tusitioya.cl', NOW() + INTERVAL '100 days')
            ON CONFLICT (id) DO UPDATE 
            SET suscripcion_hasta = NOW() + INTERVAL '100 days';
        `);
        console.log('🎁 Modo Pruebas: Usuario Admin recargado con 100 días.');
    } catch (e) {
        console.warn('⚠️ Error configurando usuarios:', e.message);
    }

    client.release();

    // 2. Iniciar el servidor Express SOLO si la BD está OK
    const startApp = (portToTry) => {
      const server = app.listen(portToTry, () => {
        console.log(`Servidor corriendo en puerto ${portToTry} | IA: ${MODEL_NAME}`);
      });

      server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          console.log(`⚠️ Puerto ${portToTry} ocupado, probando con ${portToTry + 1}...`);
          startApp(portToTry + 1);
        } else {
          console.error('❌ Error al iniciar el servidor:', e);
        }
      });
    };

    startApp(port);
  } catch (err) {
    console.error('❌ ERROR FATAL: No se pudo conectar a la Base de Datos. El servidor NO se iniciará.');
    console.error(err.stack);
    process.exit(1); // Salir del proceso con un código de error para que sea obvio que falló
  }
}

startServer();