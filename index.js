import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs'; // <--- Necesario para verificar carpetas locales
import { fileURLToPath } from 'url';
import { query, inicializarDB } from './db.js';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import 'dotenv/config';

// Autenticación
import bcrypt from 'bcryptjs'; // Para encriptar contraseñas
import jwt from 'jsonwebtoken'; // Para crear la "pulsera" de acceso

// Configuración de rutas de archivos (__dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir imágenes estáticas (Vital para cuando trabajes en Local)
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// --- CONFIGURACIÓN DE ALMACENAMIENTO HÍBRIDO (El Cerebro) ---

let storage;
const isDevelopment = process.env.NODE_ENV === 'development';

if (isDevelopment) {
    // 🏠 MODO SANDBOX (Local): Guardar en disco duro
    console.log("💾 MODO DESARROLLO: Configurando almacenamiento local...");
    
    storage = multer.diskStorage({
        destination: (req, file, cb) => {
            const pathImages = path.join(__dirname, 'public/images');
            // Crear carpeta si no existe (seguridad)
            if (!fs.existsSync(pathImages)) {
                fs.mkdirSync(pathImages, { recursive: true });
            }
            cb(null, 'public/images');
        },
        filename: (req, file, cb) => {
            // Nombre simple: tiempo + extensión
            cb(null, Date.now() + path.extname(file.originalname));
        }
    });
} else {
    // ☁️ MODO PRODUCCIÓN (Render): Guardar en Cloudinary
    console.log("☁️ MODO PRODUCCIÓN: Configurando Cloudinary...");

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });

    storage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'mi_ecommerce_productos',
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        },
    });
}

const upload = multer({ storage: storage });

// Inicializar DB
inicializarDB();

// --- MIDDLEWARE DE SEGURIDAD (El Cadenero) 👮‍♂️ ---
const verificarToken = (req, res, next) => {
    // 1. Buscar el token en las cabeceras
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ error: "Acceso denegado. No hay token." });
    }

    try {
        // 2. Verificar el token
        // NOTA: Usa la misma clave secreta que en el login
        const verificado = jwt.verify(token, process.env.JWT_SECRET || 'secreto_super_secreto');
        req.user = verificado; // Guardamos los datos del usuario en la petición
        next(); // ¡Pase usted!
    } catch (error) {
        res.status(400).json({ error: "Token inválido o expirado." });
    }
};

// --- RUTAS ---

// A. Obtener TODOS
app.get('/api/productos', async (req, res) => {
    try {
        const busqueda = req.query.q;
        const sql = busqueda 
            ? 'SELECT * FROM productos WHERE nombre ILIKE $1' 
            : 'SELECT * FROM productos';
        const params = busqueda ? [`%${busqueda}%`] : [];
        
        const resultado = await query(sql, params);
        res.json(resultado.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// B. Obtener UNO
app.get('/api/productos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await query('SELECT * FROM productos WHERE id = $1', [id]);

        if (resultado.rows.length > 0) {
            res.json(resultado.rows[0]);
        } else {
            res.status(404).json({ error: "Producto no encontrado" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// C. Crear (POST) - Lógica Híbrida de URL
app.post('/api/productos', verificarToken, upload.single('imagen'), async (req, res) => {
    try {
        const { nombre, precio, descripcion, categoria } = req.body;
        let imagenUrl = null;

        if (req.file) {
            if (isDevelopment) {
                // 🏠 Local: Construimos la URL nosotros (http://localhost:3000/images/...)
                imagenUrl = `${req.protocol}://${req.get('host')}/images/${req.file.filename}`;
            } else {
                // ☁️ Cloudinary: Nos da la URL lista en 'path'
                imagenUrl = req.file.path;
            }
        }

        const resultado = await query(
            `INSERT INTO productos (nombre, precio, descripcion, categoria, imagen) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [nombre, precio, descripcion, categoria, imagenUrl]
        );

        res.status(201).json(resultado.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// D. Eliminar
app.delete('/api/productos/:id', verificarToken, async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await query('DELETE FROM productos WHERE id = $1 RETURNING id', [id]);

        if (resultado.rowCount === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }
        res.json({ mensaje: "Producto eliminado" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// E. Actualizar (PUT) - Lógica Híbrida de URL
app.put('/api/productos/:id', verificarToken,upload.single('imagen'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, precio, descripcion, categoria } = req.body;

        let sql = '';
        let params = [];

        if (req.file) {
            // Si hay imagen nueva, calculamos la URL según el entorno
            let imagenUrl;
            if (isDevelopment) {
                imagenUrl = `${req.protocol}://${req.get('host')}/images/${req.file.filename}`;
            } else {
                imagenUrl = req.file.path;
            }

            sql = `UPDATE productos SET nombre=$1, precio=$2, descripcion=$3, categoria=$4, imagen=$5 WHERE id=$6`;
            params = [nombre, precio, descripcion, categoria, imagenUrl, id];
        } else {
            sql = `UPDATE productos SET nombre=$1, precio=$2, descripcion=$3, categoria=$4 WHERE id=$5`;
            params = [nombre, precio, descripcion, categoria, id];
        }

        const resultado = await query(sql, params);

        if (resultado.rowCount === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }

        res.json({ mensaje: "Producto actualizado" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// --- RUTAS DE AUTENTICACIÓN ---

// F. Registro de Usuario (Sign Up)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Validar que vengan los datos
        if (!email || !password) {
            return res.status(400).json({ error: "Email y contraseña son obligatorios" });
        }

        // 2. Verificar si el usuario ya existe
        const usuarioExistente = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (usuarioExistente.rows.length > 0) {
            return res.status(400).json({ error: "El email ya está registrado" });
        }

        // 3. Encriptar la contraseña (Hashing) 🔒
        // El número 10 es el "costo" (qué tan difícil es romperla).
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Guardar en la Base de Datos
        const nuevoUsuario = await query(
            'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, role',
            [email, hashedPassword]
        );

        res.status(201).json({
            mensaje: "Usuario registrado con éxito",
            usuario: nuevoUsuario.rows[0]
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
    
});


// G. Iniciar Sesión (Login)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Validar que vengan los datos
        if (!email || !password) {
            return res.status(400).json({ error: "Email y contraseña son obligatorios" });
        }

        // 2. Buscar al usuario
        const resultado = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (resultado.rows.length === 0) {
            return res.status(400).json({ error: "Credenciales inválidas" });
        }
        const usuario = resultado.rows[0];

        // 3. Verificar contraseña (comparar texto plano con encriptada) 🔒
        const passwordValida = await bcrypt.compare(password, usuario.password);
        if (!passwordValida) {
            return res.status(400).json({ error: "Credenciales inválidas" });
        }

        // 4. Generar el Token (JWT) 🎫
        // Este token contiene el ID y el ROL del usuario, y expira en 1 hora.
        // IMPORTANTE: En producción, usa una variable de entorno para 'secreto_super_secreto'
        const token = jwt.sign(
            { id: usuario.id, email: usuario.email, role: usuario.role },
            process.env.JWT_SECRET || 'secreto_super_secreto', 
            { expiresIn: '1h' }
        );

        res.json({
            mensaje: "Inicio de sesión exitoso",
            token: token,
            usuario: {
                id: usuario.id,
                email: usuario.email,
                role: usuario.role
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🔥 Servidor corriendo en puerto ${PORT}`);
    console.log(`🌍 Modo: ${isDevelopment ? 'DESARROLLO (Local)' : 'PRODUCCIÓN (Nube)'}`);
});