import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// 👇 DETECTAMOS EL ENTORNO
// Si NODE_ENV es 'production' (Render), usamos SSL.
// Si es 'development' (Tu PC), NO usamos SSL.
const isProduction = process.env.NODE_ENV === 'production';

const connectionConfig = {
    connectionString: process.env.DATABASE_URL,
    // Si la URL tiene 'localhost', apagamos SSL. Si no (es Neon), lo forzamos prendido.
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
};

export const pool = new Pool(connectionConfig);

export const query = (text, params) => pool.query(text, params);

export const inicializarDB = async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log(`✅ Base de Datos conectada (${process.env.DATABASE_URL.includes('localhost') ? 'Local 🏠' : 'Nube ☁️'})`);

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

        // --- 2. Tabla de USUARIOS ---
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

// --- 3. Tabla de CARRITO ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS carrito (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
                cantidad INTEGER DEFAULT 1,
                UNIQUE (usuario_id, producto_id) 
            );
        `);
        
        // 🔧 PARCHE AUTOMÁTICO: Le inyectamos el candado a la tabla en Neon
        try {
            await pool.query(`
                ALTER TABLE carrito 
                ADD CONSTRAINT carrito_usuario_producto_key UNIQUE (usuario_id, producto_id);
            `);
            console.log("✅ Candado UNIQUE agregado al carrito exitosamente.");
        } catch (e) {
            // Si el candado ya se había puesto antes, Postgres ignora este paso
        }
        console.log("✅ Tabla 'carrito' verificada y blindada.");


        // --- 4. Tabla de PEDIDOS (PARA EL PERFIL DEL CLIENTE) ---
 
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedidos (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                total NUMERIC(10, 2) NOT NULL,
                estado VARCHAR(50) DEFAULT 'pagado',
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                stripe_session_id VARCHAR(255) 
            );
        `);
        
        
        try {
            await pool.query(`
                ALTER TABLE pedidos 
                ADD COLUMN stripe_session_id VARCHAR(255);
            `);
            console.log("✅ Columna 'stripe_session_id' agregada exitosamente.");
        } catch (e) {
            
        }
        console.log("✅ Tabla 'pedidos' verificada y lista para Stripe.");


        // --- 5. Tabla de DETALLES DE PEDIDO (PARA EL RECIBO DE STRIPE) ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS detalles_pedido (
                id SERIAL PRIMARY KEY,
                pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
                producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
                cantidad INTEGER NOT NULL,
                precio_unitario NUMERIC(10, 2) NOT NULL
            );
        `);
        console.log("✅ Tabla 'detalles_pedido' verificada.");

    } catch (error) {
        console.error("❌ Error conectando a la DB:", error);
    }
};