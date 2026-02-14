import express from 'express';
import cors from 'cors';
import multer from 'multer'; // <--- 1. IMPORTAR MULTER
import path from 'path';     // <--- 1. IMPORTAR PATH (Viene con Node)
import { fileURLToPath } from 'url'; // Necesario para __dirname en ES Modules
//import { abrirDB, inicializarDB } from './db.js'; // Importamos nuestra DB Usando SQLite
import { query, inicializarDB } from './db.js'; // Importamos nuestra DB Usando PostgreSQL

// Truco para obtener __dirname en modulos modernos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 2. SERVIR ARCHIVOS ESTÁTICOS (Para que http://localhost:3000/images/foto.jpg funcione)
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// 3. CONFIGURACIÓN DE MULTER (Dónde y cómo guardar)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/images'); // Carpeta destino
  },
  filename: (req, file, cb) => {
    // Generamos un nombre único: timestamp + extensión original (ej: 1283123-foto.jpg)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });    

// INICIALIZAMOS LA DB AL ARRANCAR
inicializarDB();

// RUTAS CON SQL REAL

// A. Obtener TODOS (SELECT)
// A. Obtener productos (Con filtro opcional)
// ... tus imports y config de Multer siguen igual ...

// INICIALIZAR
inicializarDB();

// A. Obtener TODOS (GET)
app.get('/api/productos', async (req, res) => {
    try {
        const busqueda = req.query.q; 
        if (busqueda) {
            // En Postgres usamos $1, $2 en lugar de ?
            // ILIKE es como LIKE pero ignora mayúsculas/minúsculas (Mejor que SQLite)
            const resultado = await query(
                'SELECT * FROM productos WHERE nombre ILIKE $1', 
                [`%${busqueda}%`] 
            );
            res.json(resultado.rows); // Postgres devuelve los datos en .rows
        } else {
            const resultado = await query('SELECT * FROM productos');
            res.json(resultado.rows);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// B. Obtener UNO (GET :id)
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

// C. Crear (POST)
app.post('/api/productos', upload.single('imagen'), async (req, res) => {
    try {
        const { nombre, precio, descripcion, categoria } = req.body;
        let imagenUrl = null;
        if (req.file) imagenUrl = `http://localhost:3000/images/${req.file.filename}`;

        // RETURNING * nos devuelve el producto creado inmediatamente
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

// D. Eliminar (DELETE)
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

// E. Actualizar (PUT)
app.put('/api/productos/:id', upload.single('imagen'), async (req, res) => {
    try {
        const id = req.params.id;
        const { nombre, precio, descripcion, categoria } = req.body;
        
        let sql = '';
        let params = [];

        if (req.file) {
            const imagenUrl = `http://localhost:3000/images/${req.file.filename}`;
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
    console.log(`🔥 Servidor corriendo en http://localhost:${PORT}`);
});