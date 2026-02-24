require('dotenv').config();
const { Pool } = require('pg');

const connectionString = (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '').replace(/\?sslmode=[^&]*&?/, '?').replace(/\?$/, '');

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  },
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
    fecha_pago TIMESTAMP,
    encuesta_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const addFechaPagoColumn = `
ALTER TABLE clientes 
ADD COLUMN IF NOT EXISTS fecha_pago TIMESTAMP;
`;

const addUpdatedAtColumn = `
ALTER TABLE clientes 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
`;

const createUpdatedAtTrigger = `
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';
`;

const dropTriggerIfExists = `
DROP TRIGGER IF EXISTS update_clientes_updated_at ON clientes;
`;

const createTrigger = `
CREATE TRIGGER update_clientes_updated_at
    BEFORE UPDATE ON clientes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`;

async function setup() {
  try {
    console.log("🔌 Conectando a Neon DB...");
    await pool.query(createTableQuery);
    console.log("✅ Tabla 'clientes' creada/verificada exitosamente.");
    
    // Agregar columna fecha_pago si no existe
    await pool.query(addFechaPagoColumn);
    console.log("✅ Columna 'fecha_pago' agregada/verificada.");
    
    // Agregar columna updated_at si no existe
    await pool.query(addUpdatedAtColumn);
    console.log("✅ Columna 'updated_at' agregada/verificada.");
    
    // Crear función y trigger para auto-actualizar updated_at
    await pool.query(createUpdatedAtTrigger);
    await pool.query(dropTriggerIfExists);
    await pool.query(createTrigger);
    console.log("✅ Trigger de auto-actualización creado.");
    
    console.log("🚀 Base de datos lista para usar.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creando tabla:", err);
    process.exit(1);
  }
}

setup();