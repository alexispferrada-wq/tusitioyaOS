require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  // Configuración para mayor resiliencia con bases de datos en la nube
  connectionTimeoutMillis: 30000, // Aumentado a 30 segundos para conectar
  idleTimeoutMillis: 600000,      // Aumentado a 10 minutos para cerrar una conexión inactiva
});

const createTableQuery = `
CREATE TABLE IF NOT EXISTS clientes (
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

async function setup() {
  try {
    console.log("🔌 Conectando a Neon DB...");
    await pool.query(createTableQuery);
    console.log("✅ Tabla 'clientes' creada exitosamente.");
    console.log("🚀 Base de datos lista para usar.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creando tabla:", err);
    process.exit(1);
  }
}

setup();