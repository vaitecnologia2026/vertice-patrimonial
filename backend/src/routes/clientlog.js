const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Anti-flood: no máximo 30 reports por minuto por IP
const logLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false },
});

const s = (v, n) => (v == null ? null : String(v).slice(0, n));

// Ruído conhecido e inofensivo do browser — descartado na ENTRADA (não é bug de app).
// Protege os Logs de Erro mesmo de clientes com bundle antigo (sem o filtro no front).
const IGNORE_MSG = ['ResizeObserver loop', 'Script error.'];

// POST /api/client-log — PÚBLICO (captura erros até de quem não está logado).
// Best-effort: nunca devolve erro pro cliente.
router.post('/', logLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const message = s(b.message, 2000) || 'sem mensagem';
    if (IGNORE_MSG.some((p) => message.includes(p))) return res.status(200).json({ ok: true, ignored: true });
    await prisma.clientError.create({
      data: {
        kind: s(b.kind, 40) || 'error',
        message,
        stack: s(b.stack, 8000),
        url: s(b.url, 500),
        userAgent: s(req.headers['user-agent'], 300),
        userEmail: s(b.userEmail, 200),
      },
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false });
  }
});

// GET /api/client-log — admin: lista paginada
router.get('/', auth, adminOnly, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const [list, total, naoResolvidos] = await Promise.all([
      prisma.clientError.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.clientError.count(),
      prisma.clientError.count({ where: { resolved: false } }),
    ]);
    res.json({ list, total, naoResolvidos, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/client-log/:id/resolve — admin
router.patch('/:id/resolve', auth, adminOnly, async (req, res, next) => {
  try {
    const e = await prisma.clientError.update({
      where: { id: req.params.id },
      data: { resolved: !!req.body.resolved },
    });
    res.json(e);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/client-log — admin: limpa tudo
router.delete('/', auth, adminOnly, async (req, res, next) => {
  try {
    const r = await prisma.clientError.deleteMany({});
    res.json({ deleted: r.count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
