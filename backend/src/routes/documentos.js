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
    if (req.query.cliId) {
      // Validar que cliId pertence ao tenant do user (LIC) — previne IDOR via query
      if (req.user.role === 'LIC') {
        const cli = await prisma.cliente.findUnique({ where: { id: req.query.cliId }, select: { licId: true } });
        if (!cli || cli.licId !== req.user.licId) {
          return res.status(403).json({ error: 'Acesso negado a este cliente.' });
        }
      }
      where.cliId = req.query.cliId;
    }
    const list = await prisma.documento.findMany({ where, orderBy: { data: 'desc' } });
    res.json(list);
  } catch (err) { next(err); }
});

// Sanitiza nome (remove tags HTML) e valida URL como caminho interno
const sanitizeNome = (s) => String(s || 'Sem nome').replace(/[<>]/g, '').slice(0, 200);
const isInternalUrl = (u) => typeof u === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(u);

router.post('/', auth, upload.single('arquivo'), async (req, res, next) => {
  try {
    const licId = req.user.role === 'LIC' ? req.user.licId : (req.body.licId || null);
    const cliId = req.body.cliId || null;

    // Validação: cliId só pode pertencer ao próprio tenant (impede LIC anexar doc a cliente alheio)
    if (cliId) {
      const cli = await prisma.cliente.findUnique({ where: { id: cliId }, select: { licId: true } });
      if (!cli) return res.status(404).json({ error: 'Cliente não encontrado.' });
      if (req.user.role === 'LIC' && cli.licId !== req.user.licId) {
        return res.status(403).json({ error: 'Cliente pertence a outra licença.' });
      }
    }

    // URL: só aceita /uploads/<filename> gerado pelo próprio multer.
    // Bloqueia inserção de javascript:, data:, http://evil.com, etc.
    let url;
    if (req.file) {
      url = `/uploads/${req.file.filename}`;
    } else if (req.body.url) {
      if (!isInternalUrl(req.body.url)) {
        return res.status(400).json({ error: 'URL inválida — apenas caminhos /uploads/* são aceitos.' });
      }
      url = req.body.url;
    } else {
      return res.status(400).json({ error: 'Forneça um arquivo ou uma URL interna válida.' });
    }

    const tipo = String(req.body.tipo || 'outro').slice(0, 50);

    const doc = await prisma.documento.create({
      data: {
        nome: sanitizeNome(req.file?.originalname || req.body.nome),
        tipo,
        tam: req.file ? `${(req.file.size / 1024).toFixed(0)} KB` : null,
        url,
        cliId,
        licId,
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
