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
import Stripe from 'stripe';

// Autenticación
import bcrypt from 'bcryptjs'; // Para encriptar contraseñas
import jwt from 'jsonwebtoken'; // Para crear la "pulsera" de acceso

// Inicializamos Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

// ==========================================
// 🛡️ MIDDLEWARE: Verificar si es Administrador (VERSIÓN BILINGÜE)
// ==========================================
// ==========================================
// 🛡️ MIDDLEWARE: Verificar si es Administrador (VERSIÓN BD)
// ==========================================
const verificarAdmin = async (req, res, next) => {
    try {
        // Tu middleware verificarToken ya nos dejó el ID en req.user.id
        // Reemplaza la línea que dice "const usuarioId = req.user.id;" por esta:
        const usuarioId = req.user?.id || req.usuario?.id; 

        // Vamos directo a la Base de Datos a revisar su contrato
        const resultado = await query('SELECT * FROM users WHERE id = $1', [usuarioId]);

        if (resultado.rows.length === 0) {
            return res.status(403).json({ mensaje: "Usuario no encontrado." });
        }

        const usuarioReal = resultado.rows[0];
        // Atrapamos la columna sin importar si le pusiste "rol" o "role"
        const rolDelUsuario = String(usuarioReal.rol || usuarioReal.role).toLowerCase();

        if (rolDelUsuario === 'admin') {
            console.log(`✅ Permiso concedido desde la BD al usuario: ${usuarioReal.email}`);
            next(); // ¡Pase usted, jefe!
        } else {
            console.warn(`⛔ Intento bloqueado. El usuario es: ${rolDelUsuario}`);
            res.status(403).json({ mensaje: "Se requiere ser Administrador." });
        }
    } catch (error) {
        console.error("Error crítico en verificarAdmin:", error);
        res.status(500).json({ error: "Error interno al verificar permisos" });
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
app.post('/api/productos', verificarToken, verificarAdmin, upload.single('imagen'), async (req, res) => {
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

// D. Eliminar producto
app.delete('/api/productos/:id', verificarToken, verificarAdmin, async (req, res) => {
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
app.put('/api/productos/:id', verificarToken, verificarAdmin, upload.single('imagen'), async (req, res) => {
    try {
        console.log(`🛠️ Iniciando actualización del producto ID: ${req.params.id}`);
        const { id } = req.params;
        const { nombre, precio, descripcion, categoria } = req.body;

        let sql = '';
        let params = [];

        if (req.file) {
            let imagenUrl;
            // Ojo: Asegúrate de que 'isDevelopment' exista en tu archivo, si no, pon true temporalmente
            if (process.env.NODE_ENV !== 'production') { 
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
            console.log("❌ Producto no encontrado en la BD");
            return res.status(404).json({ error: "Producto no encontrado" });
        }

        console.log("✅ Producto actualizado en la BD. Enviando 200 OK a React...");
        return res.status(200).json({ mensaje: "Producto actualizado" });

    } catch (error) {
        console.error("🚨 Error en el CATCH del PUT:", error);
        return res.status(500).json({ error: error.message });
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

// RUTA DE REGISTRO
app.post('/api/auth/register', async (req, res) => {
    const { nombre, email, password } = req.body;

    try {
        // 1. Encriptar la contraseña 🛡️
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 2. Guardar en la base de datos
        // Usamos RETURNING id para confirmar que se creó
        const nuevoUsuario = await pool.query(
            'INSERT INTO usuarios (nombre, email, password) VALUES ($1, $2, $3) RETURNING id, email',
            [nombre, email, hashedPassword]
        );

        res.status(201).json({
            mensaje: "Usuario registrado con éxito",
            usuario: nuevoUsuario.rows[0]
        });
    } catch (error) {
        console.error(error);
        if (error.code === '23505') { // Código de error para email duplicado en Postgres
            return res.status(400).json({ mensaje: "El correo ya está registrado" });
        }
        res.status(500).json({ mensaje: "Error al registrar usuario" });
    }
});

// ==========================================
// 🛒 RUTAS DEL CARRITO DE COMPRAS
// ==========================================

// AGREGAR PRODUCTO AL CARRITO
app.post('/api/carrito', verificarToken, async (req, res) => {
    const usuario_id = req.user.id; 
    const { producto_id, cantidad } = req.body;

    try {
        // ✅ CORRECCIÓN: Cambiamos el nombre de la variable a 'sql' para que no choque
        const sql = `
            INSERT INTO carrito (usuario_id, producto_id, cantidad)
            VALUES ($1, $2, $3)
            ON CONFLICT (usuario_id, producto_id) 
            DO UPDATE SET cantidad = carrito.cantidad + EXCLUDED.cantidad
            RETURNING *;
        `;
        
        // ✅ CORRECCIÓN: Usamos 'query' en lugar de 'pool.query'
        const resultado = await query(sql, [usuario_id, producto_id, cantidad || 1]);
        
        res.status(200).json({ 
            mensaje: "Producto guardado en tu carrito de la nube ☁️", 
            item: resultado.rows[0] 
        });

    } catch (error) {
        console.error("Error en el carrito:", error);
        res.status(500).json({ mensaje: "Hubo un error al guardar en el carrito" });
    }
});


// OBTENER EL CARRITO DEL USUARIO
app.get('/api/carrito', verificarToken, async (req, res) => {
    const usuario_id = req.user.id;

    try {
        // ✅ CORRECCIÓN: Cambiamos el nombre de la variable a 'sql'
        const sql = `
            SELECT c.id AS carrito_item_id, c.cantidad, p.*
            FROM carrito c
            JOIN productos p ON c.producto_id = p.id
            WHERE c.usuario_id = $1;
        `;
        
        // ✅ CORRECCIÓN: Usamos 'query' en lugar de 'pool.query'
        const resultado = await query(sql, [usuario_id]);
        res.status(200).json(resultado.rows);
        
    } catch (error) {
        console.error("Error al obtener carrito:", error);
        res.status(500).json({ mensaje: "Error al cargar el carrito" });
    }
});

// ELIMINAR PRODUCTO DEL CARRITO
app.delete('/api/carrito/:producto_id', verificarToken, async (req, res) => {
    const usuario_id = req.user.id;
    const { producto_id } = req.params;

    try {
        // Borramos el producto específico para este usuario
        await query(
            'DELETE FROM carrito WHERE usuario_id = $1 AND producto_id = $2', 
            [usuario_id, producto_id]
        );
        res.json({ mensaje: "Producto eliminado de la base de datos" });
    } catch (error) {
        console.error("Error al eliminar del carrito:", error);
        res.status(500).json({ mensaje: "Error al eliminar" });
    }
});

// VACIAR CARRITO COMPLETO (Después de una compra exitosa)
app.delete('/api/carrito', verificarToken, async (req, res) => {
    const usuario_id = req.user.id;
    try {
        await query('DELETE FROM carrito WHERE usuario_id = $1', [usuario_id]);
        res.json({ mensaje: "Carrito vaciado exitosamente tras la compra" });
    } catch (error) {
        console.error("Error al vaciar carrito:", error);
        res.status(500).json({ mensaje: "Error al vaciar carrito" });
    }
});

// ACTUALIZAR CANTIDAD EN EL CARRITO (Restar o sumar un número específico)
app.put('/api/carrito/:producto_id', verificarToken, async (req, res) => {
    const usuario_id = req.user.id;
    const { producto_id } = req.params;
    const { cantidad } = req.body; // Recibimos la nueva cantidad desde el frontend

    try {
        const sql = `
            UPDATE carrito 
            SET cantidad = $1 
            WHERE usuario_id = $2 AND producto_id = $3
            RETURNING *;
        `;
        
        // Ejecutamos el query pasándole la nueva cantidad, el usuario y el producto
        const resultado = await query(sql, [cantidad, usuario_id, producto_id]);
        
        if (resultado.rowCount === 0) {
            return res.status(404).json({ mensaje: "Producto no encontrado en tu carrito" });
        }

        res.status(200).json({ 
            mensaje: "Cantidad actualizada correctamente 🔄",
            item: resultado.rows[0]
        });

    } catch (error) {
        console.error("Error al actualizar la cantidad del carrito:", error);
        res.status(500).json({ mensaje: "Error al modificar la cantidad" });
    }
});


// ==========================================
// 💳 PASARELA DE PAGOS (STRIPE)
// ==========================================

// ==========================================
// 💳 PASARELA DE PAGOS (STRIPE)
// ==========================================

app.post('/api/crear-sesion-checkout', verificarToken, async (req, res) => {
    try {
        const { carrito } = req.body;
        const usuario_id = req.user.id;

        // 1. Calculamos el total exacto en el backend (Por seguridad, para que no lo alteren)
        const totalPedido = carrito.reduce((suma, item) => suma + (Number(item.precio) * Number(item.cantidad || 1)), 0);

        // 2. Creamos el "Ticket" principal en la BD (Estado: pendiente)
        const pedidoResult = await query(
            `INSERT INTO pedidos (usuario_id, total, estado) VALUES ($1, $2, 'pendiente') RETURNING id`,
            [usuario_id, totalPedido]
        );
        const pedido_id = pedidoResult.rows[0].id;

        // 3. Guardamos los detalles (Metemos los tenis a la caja virtual)
        for (let item of carrito) {
            await query(
                `INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)`,
                [pedido_id, item.id, item.cantidad || 1, item.precio]
            );
        }

        // 4. Transformamos el carrito al formato que exige Stripe
        const lineItems = carrito.map((item) => ({
            price_data: {
                currency: 'mxn',
                product_data: { name: item.nombre },
                unit_amount: Math.round(item.precio * 100), 
            },
            quantity: item.cantidad || 1,
        }));

        // 5. Creamos la sesión de cobro en Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${API_URL}/pago-exitoso?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${API_URL}/carrito`,
            client_reference_id: pedido_id.toString(), // 👈 ¡CLAVE! Enlazamos Stripe con tu BD
        });

        // 6. Actualizamos tu "Ticket" guardando el ID de la sesión de Stripe
        await query(
            `UPDATE pedidos SET stripe_session_id = $1 WHERE id = $2`,
            [session.id, pedido_id]
        );

        // 7. Le devolvemos a React la URL de la caja registradora
        res.json({ url: session.url });

    } catch (error) {
        console.error("Error al crear sesión de Stripe:", error);
        res.status(500).json({ error: "Error al procesar el pago" });
    }
});


// MARCAR PEDIDO COMO PAGADO ✅
app.post('/api/confirmar-pago', verificarToken, async (req, res) => {
    const { session_id } = req.body;

    try {
        // Buscamos el pedido que tenga esa sesión de Stripe y lo actualizamos
        const resultado = await query(
            `UPDATE pedidos SET estado = 'pagado' WHERE stripe_session_id = $1 RETURNING id`,
            [session_id]
        );

        if (resultado.rowCount > 0) {
            res.json({ mensaje: "¡Pedido actualizado a PAGADO exitosamente!" });
        } else {
            res.status(404).json({ error: "No se encontró el pedido" });
        }
    } catch (error) {
        console.error("Error al confirmar pago:", error);
        res.status(500).json({ error: "Error al actualizar el estado del pedido" });
    }
});


// ==========================================
// 🛠️ PANEL ADMIN: GESTIÓN DE PEDIDOS
// ==========================================

// 1. OBTENER TODAS LAS VENTAS
app.get('/api/admin/pedidos', verificarToken, async (req, res) => {
    try {
        // Hacemos un JOIN para traer el pedido y el email del cliente que lo compró
        const resultado = await query(`
            SELECT p.id, p.total, p.estado, p.creado_en, u.email 
            FROM pedidos p
            JOIN users u ON p.usuario_id = u.id
            ORDER BY p.creado_en DESC
        `);
        res.json(resultado.rows);
    } catch (error) {
        console.error("Error al obtener pedidos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// 2. MARCAR PEDIDO COMO ENVIADO 🚚
app.put('/api/admin/pedidos/:id/estado', verificarToken, async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body; 

    try {
        await query('UPDATE pedidos SET estado = $1 WHERE id = $2', [estado, id]);
        res.json({ mensaje: "¡Estado del pedido actualizado!" });
    } catch (error) {
        console.error("Error al actualizar estado:", error);
        res.status(500).json({ error: "Error al actualizar" });
    }
});



// ==========================================
// 🛍️ PERFIL DEL CLIENTE: MIS PEDIDOS
// ==========================================

app.get('/api/mis-pedidos', verificarToken, async (req, res) => {
    try {
        // El token ya nos dice quién es exactamente el usuario
        const usuario_id = req.user.id; 

        // Buscamos SOLO los pedidos que le pertenecen a este ID
        const resultado = await query(`
            SELECT id, total, estado, creado_en 
            FROM pedidos 
            WHERE usuario_id = $1 
            ORDER BY creado_en DESC
        `, [usuario_id]);

        res.json(resultado.rows);
    } catch (error) {
        console.error("Error al obtener el historial del cliente:", error);
        res.status(500).json({ error: "Error al cargar el historial de pedidos" });
    }
});


app.listen(PORT, () => {
    console.log(`🔥 Servidor corriendo en puerto ${PORT}`);
    console.log(`🌍 Modo: ${isDevelopment ? 'DESARROLLO (Local)' : 'PRODUCCIÓN (Nube)'}`);
});