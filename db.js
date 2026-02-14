import pg from 'pg';
import dotenv from 'dotenv';

// Cargar las variables del archivo .env
dotenv.config();

// Creamos el "Pool" de conexiones (Un grupo de conexiones listas para usar)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para Neon
  }
});

// Función para obtener conexión y hacer consultas
export const query = (text, params) => pool.query(text, params);

// Inicializar la tabla (Sintaxis PostgreSQL)
export async function inicializarDB() {
  try {
    console.log("🔌 Conectando a PostgreSQL en la nube...");
    
    // SERIAL es el equivalente a AUTOINCREMENT en Postgres
    await query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        precio NUMERIC NOT NULL,
        descripcion TEXT,
        categoria TEXT,
        imagen TEXT
      )
    `);

    console.log("✅ Tabla 'productos' verificada en la nube.");
  } catch (error) {
    console.error("❌ Error conectando a la DB:", error);
  }
}