require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Permite que tu HTML local se conecte aquí
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para parsear datos de formularios
app.use(express.static(__dirname)); // Servir archivos estáticos (HTML, etc.)

// Verificación rápida: Asegurar que la variable de entorno existe
if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR CRÍTICO: No se encontró la variable DATABASE_URL en el archivo .env");
  console.error("   -> Asegúrate de crear el archivo .env y definir tu conexión a Neon.");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ ERROR CRÍTICO: No se encontró la variable GEMINI_API_KEY en el archivo .env");
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
  res.redirect('/previo_comando.html');
});
 
// Fix para móviles: Redirigir rutas sin extensión a la vista correcta
app.get('/previo_comando', (req, res) => {
  res.redirect('/previo_comando.html');
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
    const result = await client.query('SELECT * FROM clientes WHERE id = $1', [id]);
    
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

        const query = `
          INSERT INTO clientes (nombre, negocio, whatsapp, dominio, monto_total, estado, propuesta_text, ciudad, rut, encuesta_data, created_at)
          VALUES ($1, $2, $3, $4, $5, 'prospecto', $6, $7, $8, $9, NOW())
          RETURNING *
        `;
        const resDB = await client.query(query, [nombre, negocio, whatsapp, dominio, 72000, propuesta, ciudad, rut, encuestaData]);
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

    const query = `
      INSERT INTO clientes (nombre, rut, negocio, whatsapp, dominio, monto_total, monto_pagado, propuesta_text, encuesta_data)
      VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)
      RETURNING *
    `;
    const values = [nombre, rut, negocio, whatsapp, dominio, monto_total, propuesta_text, encuestaData];
    const result = await client.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear cliente' });
  } finally {
    if (client) client.release();
  }
});

// A.3 Editar cliente (Guardar cambios de montos)
app.put('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;
  const { 
      monto_total, monto_pagado, whatsapp, nombre, negocio, dominio, 
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


// --- INICIAR SERVIDOR ---
async function startServer() {
  try {
    // 1. Probar conexión a la base de datos antes de iniciar
    const client = await pool.connect();
    console.log('✅ Base de Datos NEON conectada correctamente.');
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