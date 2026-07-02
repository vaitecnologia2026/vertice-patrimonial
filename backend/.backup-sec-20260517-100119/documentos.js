const express = require('express');
const multer = require('multer');
const path = require('path');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { isAllowedFile } = require('../utils/sanitize');

const router = express.Router();

const storage = multer.diskStorage({
  destination: process.env.UPLOAD_DIR || './uploads',
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedFile(file.originalname)) {
      return cb(new Error('Tipo de arquivo não permitido.'), false);
    }
    cb(null, true);
  },
});

router.get('/', auth, async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (req.query.licId) where.licId = req.query.licId;
    if (req.query.cliId) where.cliId = req.query.cliId;
    const list = await prisma.documento.findMany({ where, orderBy: { data: 'desc' } });
    res.json(list);
  } catch (err) { next(err); }
});

router.post('/', auth, upload.single('arquivo'), async (req, res, next) => {
  try {
    const doc = await prisma.documento.create({
      data: {
        nome: req.file?.originalname || req.body.nome || 'Sem nome',
        tipo: req.body.tipo || 'outro',
        tam: req.file ? `${(req.file.size / 1024).toFixed(0)} KB` : null,
        url: req.file ? `/uploads/${req.file.filename}` : req.body.url,
        cliId: req.body.cliId || null,
        licId: req.user.role === 'LIC' ? req.user.licId : (req.body.licId || null),
      },
    });
    res.status(201).json(doc);
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    const validStatus = ['PENDENTE', 'ENTREGUE', 'REJEITADO'];
    if (!validStatus.includes(req.body.status?.toUpperCase())) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const doc = await prisma.documento.update({
      where: { id: req.params.id },
      data: { status: req.body.status.toUpperCase() },
    });
    res.json(doc);
  } catch (err) { next(err); }
});

module.exports = router;
