require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Permite que tu HTML local se conecte aquí
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Para parsear datos de formularios
app.use(express.static(__dirname)); // Servir archivos estáticos (HTML, etc.)

// 1. Conexión a NEON (PostgreSQL)
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
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
const MODEL_NAME = "gemini-1.5-flash"; // Modelo por defecto (suele tener alta disponibilidad)

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
                    model: 'llama-3.1-8b-instant', // Forzamos un modelo rápido y barato de Groq para el video
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
            const aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Forzamos Flash para velocidad
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
            const fallbackModel = modelToUse.includes('gemini') ? 'groq-llama-3.1-8b-instant' : 'gemini-1.5-flash';
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
      email, rubro, url // from encuesta_data
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
    let encuestaUpdates = {};
    if (monto_mantencion !== undefined) encuestaUpdates.monto_mantencion = monto_mantencion;
    if (email !== undefined) encuestaUpdates.email = email;
    if (rubro !== undefined) encuestaUpdates.rubro = rubro;
    if (url !== undefined) encuestaUpdates.url = url;

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
      const model = genAI.getGenerativeModel({ model: modelToUse });
      const result = await model.generateContent(detailedPrompt);
      const response = await result.response;
      analisisText = response.text();
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
  
  if (!cliente_id) {
    return res.status(400).send('<h1>Error: Falta el ID del cliente.</h1>');
  }

  let client;
  try {
    client = await pool.connect();
    const query = `
      UPDATE clientes
      SET encuesta_data = $1
      WHERE id = $2
    `;
    await client.query(query, [formData, cliente_id]);
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