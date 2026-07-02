const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Arquivos vão pro disco (/app/uploads, montado em volume persistente) e são servidos
// pelo static /uploads. Tira fotos/PDF/planilha do JSON espelhado (mm5) — era o base64
// nesse JSON que estourava o localStorage e fazia "sumir" os dados.
const UP_DIR = path.join(__dirname, '../../uploads');
try { fs.mkdirSync(UP_DIR, { recursive: true }); } catch (_) { /* já existe */ }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').slice(0, 12).replace(/[^.\w]/g, '');
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 10) + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

// POST /api/uploads — sobe 1 arquivo → devolve a URL pública (/uploads/<nome>).
router.post('/', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  res.json({ url: '/uploads/' + req.file.filename, nome: req.file.originalname || req.file.filename });
});

module.exports = router;
