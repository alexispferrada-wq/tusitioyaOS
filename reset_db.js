require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 600000,
});

async function reset() {
  const client = await pool.connect();
  try {
    console.log("🚨 INICIANDO RESET DE FÁBRICA...");
    
    // 1. Eliminar tabla existente
    console.log("🗑️  Eliminando datos antiguos...");
    await client.query('DROP TABLE IF EXISTS clientes');
    
    // 2. Crear tabla nueva (Esquema de Producción)
    console.log("✨ Creando estructura limpia...");
    const createTableQuery = `
    CREATE TABLE clientes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255),
        rut VARCHAR(20),
        negocio VARCHAR(255),
        whatsapp VARCHAR(50),
        dominio VARCHAR(100),
        monto_total INTEGER DEFAULT 0,
        monto_pagado INTEGER DEFAULT 0,
        estado VARCHAR(50) DEFAULT 'prospecto',
        propuesta_text TEXT,
        ciudad VARCHAR(100),
        fecha_contacto TIMESTAMP,
        fecha_seguimiento TIMESTAMP,
        fecha_proximo_pago DATE,
        encuesta_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    `;
    await client.query(createTableQuery);
    
    console.log("✅ SISTEMA LISTO PARA PRODUCCIÓN (Base de datos vacía).");
  } catch (err) {
    console.error("❌ Error durante el reset:", err);
  } finally {
    client.release();
    pool.end();
  }
}

reset();