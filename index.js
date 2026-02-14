import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, inicializarDB } from './db.js'; // DB PostgreSQL

// Truco para obtener __dirname en modulos modernos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir archivos estáticos
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Configuración de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Inicializar DB
inicializarDB();

// --- RUTAS ---

// A. Obtener TODOS
app.get('/api/productos', async (req, res) => {
    try {
        const busqueda = req.query.q;
        if (busqueda) {
            const resultado = await query(
                'SELECT * FROM productos WHERE nombre ILIKE $1',
                [`%${busqueda}%`]
            );
            res.json(resultado.rows);
        } else {
            const resultado = await query('SELECT * FROM productos');
            res.json(resultado.rows);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// B. Obtener UNO
app.get('/api/productos/:id', async (req, res) => {
    try {
        const id = req.params.id;
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

// C. Crear (POST) - CORREGIDO AQUI 🔴
app.post('/api/productos', upload.single('imagen'), async (req, res) => {
    try {
        const { nombre, precio, descripcion, categoria } = req.body;

        let imagenUrl = null;
        if (req.file) {
            // 👇👇👇 AQUI TIENES QUE PONER TU URL REAL DE RENDER 👇👇👇
            const urlBase = 'https://api-mi-ecommerce.onrender.com'; 
            // 👆👆👆 CAMBIA ESTO POR TU URL EXACTA (SIN BARRA AL FINAL)
            
            imagenUrl = `${urlBase}/images/${req.file.filename}`;
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
app.delete('/api/productos/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const resultado = await query('DELETE FROM productos WHERE id = $1 RETURNING id', [id]);

        if (resultado.rowCount === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }
        res.json({ mensaje: "Producto eliminado" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// E. Actualizar (PUT) - CORREGIDO AQUI 🔴
app.put('/api/productos/:id', upload.single('imagen'), async (req, res) => {
    try {
        const id = req.params.id;
        const { nombre, precio, descripcion, categoria } = req.body;

        let sql = '';
        let params = [];

        if (req.file) {
            // 👇👇👇 AQUI TAMBIEN 👇👇👇
            const urlBase = 'https://api-mi-ecommerce.onrender.com';
            // 👆👆👆 TU URL DE RENDER
            
            const imagenUrl = `${urlBase}/images/${req.file.filename}`;
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

app.listen(PORT, () => {
    console.log(`🔥 Servidor corriendo en puerto ${PORT}`);
});