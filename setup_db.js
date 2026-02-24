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

// 🆕 TABLA: Suscripciones/Membresías de clientes
const createSuscripcionesTable = `
CREATE TABLE IF NOT EXISTS suscripciones (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    plan_nombre VARCHAR(100) NOT NULL DEFAULT 'Básico',
    plan_tipo VARCHAR(50) DEFAULT 'mensual',
    monto_mensual DECIMAL(10,2) DEFAULT 0,
    estado_suscripcion VARCHAR(50) DEFAULT 'activa',
    fecha_inicio DATE DEFAULT CURRENT_DATE,
    fecha_proximo_pago DATE,
    fecha_ultimo_pago DATE,
    dia_cobro INTEGER DEFAULT 1,
    notas TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

// 🆕 TABLA: Historial de pagos recibidos
const createPagosTable = `
CREATE TABLE IF NOT EXISTS pagos_recibidos (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    suscripcion_id INTEGER REFERENCES suscripciones(id) ON DELETE SET NULL,
    monto DECIMAL(10,2) NOT NULL,
    metodo_pago VARCHAR(50) DEFAULT 'transferencia',
    concepto VARCHAR(255),
    mes_pagado VARCHAR(20),
    anio_pagado INTEGER,
    estado_pago VARCHAR(50) DEFAULT 'pagado',
    comprobante_url TEXT,
    notas TEXT,
    fecha_pago TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

// 🆕 TABLA: Recordatorios de pago
const createRecordatoriosTable = `
CREATE TABLE IF NOT EXISTS recordatorios_pago (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    tipo_recordatorio VARCHAR(50) DEFAULT 'vencimiento',
    fecha_envio DATE,
    enviado BOOLEAN DEFAULT false,
    mensaje TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

// 🆕 Agregar campos de suscripción a clientes
const addSuscripcionColumns = `
ALTER TABLE clientes 
ADD COLUMN IF NOT EXISTS tiene_suscripcion BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tipo_suscripcion VARCHAR(50) DEFAULT 'ninguna',
ADD COLUMN IF NOT EXISTS monto_mensual DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(50) DEFAULT 'pendiente',
ADD COLUMN IF NOT EXISTS dias_mora INTEGER DEFAULT 0;
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
    
    // 🆕 Crear tabla de suscripciones
    await pool.query(createSuscripcionesTable);
    console.log("✅ Tabla 'suscripciones' creada/verificada.");
    
    // 🆕 Crear tabla de pagos recibidos
    await pool.query(createPagosTable);
    console.log("✅ Tabla 'pagos_recibidos' creada/verificada.");
    
    // 🆕 Crear tabla de recordatorios
    await pool.query(createRecordatoriosTable);
    console.log("✅ Tabla 'recordatorios_pago' creada/verificada.");
    
    // 🆕 Agregar columnas de suscripción a clientes
    await pool.query(addSuscripcionColumns);
    console.log("✅ Columnas de suscripción agregadas a 'clientes'.");
    
    console.log("🚀 Base de datos lista para usar.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creando tabla:", err);
    process.exit(1);
  }
}

setup();