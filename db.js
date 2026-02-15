import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// 👇 DETECTAMOS EL ENTORNO
// Si NODE_ENV es 'production' (Render), usamos SSL.
// Si es 'development' (Tu PC), NO usamos SSL.
const isProduction = process.env.NODE_ENV === 'production';

const connectionConfig = {
    connectionString: process.env.DATABASE_URL,
    // 👇 LA MAGIA: SSL condicional
    ssl: isProduction ? { rejectUnauthorized: false } : false 
};

export const pool = new Pool(connectionConfig);

export const query = (text, params) => pool.query(text, params);

export const inicializarDB = async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log(`✅ Base de Datos conectada (${isProduction ? 'Nube ☁️' : 'Local 🏠'})`);

        // --- 1. Tabla de PRODUCTOS ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS productos (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL,
                precio NUMERIC(10, 2) NOT NULL,
                descripcion TEXT,
                categoria VARCHAR(100),
                imagen TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Tabla 'productos' verificada.");

        // --- 2. Tabla de USUARIOS (NUEVO) ---
        // Esta es la que necesitamos para el Login y Registro
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Tabla 'users' verificada.");

    } catch (error) {
        console.error("❌ Error conectando a la DB:", error);
    }
};