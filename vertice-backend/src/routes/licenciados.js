const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const LIC_FIELDS = ['nome', 'empresa', 'cnpj', 'estado', 'email', 'tel', 'pix', 'banco', 'status', 'meta', 'inicio', 'ano', 'taxa', 'comHE'];

// GET /api/licenciados
router.get('/', auth, async (req, res, next) => {
  try {
    const { status, estado, q } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (estado) where.estado = estado;
    if (q) where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { empresa: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];

    if (req.user.role === 'LIC') where.id = req.user.licId;

    const licenciados = await prisma.licenciado.findMany({
      where,
      include: {
        _count: { select: { clientes: true, vendas: true } },
        metas: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { nome: 'asc' },
    });

    res.json(licenciados);
  } catch (err) { next(err); }
});

// GET /api/licenciados/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    if (req.user.role === 'LIC' && req.user.licId !== req.params.id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const lic = await prisma.licenciado.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(lic);
  } catch (err) { next(err); }
});

// POST /api/licenciados
router.post('/', auth, adminOnly, [
  body('nome').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('cnpj').notEmpty().trim(),
  body('estado').isLength({ min: 2, max: 2 }),
  body('senha').isLength({ min: 8 }).withMessage('Senha mínima 8 caracteres.'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { senha } = req.body;
    const data = pick(req.body, LIC_FIELDS);

    const lic = await prisma.licenciado.create({
      data: { ...data, inicio: data.inicio ? new Date(data.inicio) : new Date() },
    });

    const hash = await bcrypt.hash(senha, 12);
    await prisma.user.create({
      data: { email: data.email, password: hash, name: data.nome, role: 'LIC', licId: lic.id },
    });

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'LICENCIADO_CRIADO', entityId: lic.id, desc: `Licenciado ${lic.nome} criado`, ip: req.ip },
    });

    res.status(201).json(lic);
  } catch (err) { next(err); }
});

// PUT /api/licenciados/:id
router.put('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const { senha } = req.body;
    const data = pick(req.body, LIC_FIELDS);

    const lic = await prisma.licenciado.update({
      where: { id: req.params.id },
      data: { ...data, ...(data.inicio && { inicio: new Date(data.inicio) }) },
    });

    if (senha && senha.length >= 8) {
      const hash = await bcrypt.hash(senha, 12);
      // Update only the first/primary user linked to this licenciado
      const primaryUser = await prisma.user.findFirst({ where: { licId: lic.id }, orderBy: { createdAt: 'asc' } });
      if (primaryUser) {
        await prisma.user.update({ where: { id: primaryUser.id }, data: { password: hash } });
      }
    }

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'LICENCIADO_ATUALIZADO', entityId: lic.id, desc: `Licenciado ${lic.nome} atualizado`, ip: req.ip },
    });

    res.json(lic);
  } catch (err) { next(err); }
});

// PATCH /api/licenciados/:id/status
router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatus = ['ATIVO', 'SUSPENSO', 'INATIVO'];
    if (!validStatus.includes(status?.toUpperCase())) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const lic = await prisma.licenciado.update({
      where: { id: req.params.id },
      data: { status: status.toUpperCase() },
    });
    res.json(lic);
  } catch (err) { next(err); }
});

module.exports = router;
