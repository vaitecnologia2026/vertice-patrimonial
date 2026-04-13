const express = require('express');
const prisma = require('../utils/prisma');
const { auth } = require('../middleware/auth');
const { pick, formatCPF } = require('../utils/sanitize');

const router = express.Router();

const CLI_FIELDS = ['nome', 'cpf', 'tel', 'email', 'orig', 'end', 'status', 'prod', 'data', 'licId'];

// GET /api/clientes
router.get('/', auth, async (req, res, next) => {
  try {
    const { q, status, licId } = req.query;
    const where = {};
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (licId) where.licId = licId;
    if (status) where.status = status.toUpperCase();
    if (q) where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { cpf: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
    ];

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [clientes, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        include: {
          licenciado: { select: { nome: true } },
          _count: { select: { vendas: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.cliente.count({ where }),
    ]);
    res.json({ data: clientes, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// GET /api/clientes/check-cpf/:cpf
router.get('/check-cpf/:cpf', auth, async (req, res, next) => {
  try {
    const cpf = formatCPF(req.params.cpf);
    if (!cpf) return res.json({ exists: false, cliente: null });
    const existing = await prisma.cliente.findUnique({
      where: { cpf },
      include: { licenciado: { select: { nome: true } } },
    });
    res.json({ exists: !!existing, cliente: existing });
  } catch (err) { next(err); }
});

// POST /api/clientes
router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, CLI_FIELDS);
    data.licId = req.user.role === 'LIC' ? req.user.licId : data.licId;
    if (!data.licId) return res.status(400).json({ error: 'licId é obrigatório.' });
    if (!data.nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!data.cpf) return res.status(400).json({ error: 'CPF é obrigatório.' });
    if (data.cpf) {
      const cpf = formatCPF(data.cpf);
      if (!cpf) return res.status(400).json({ error: 'CPF inválido.' });
      data.cpf = cpf;
    }
    data.data = data.data ? new Date(data.data) : new Date();
    const cli = await prisma.cliente.create({ data });
    res.status(201).json(cli);
  } catch (err) { next(err); }
});

// PUT /api/clientes/:id
router.put('/:id', auth, async (req, res, next) => {
  try {
    // Verificar ownership para LIC
    if (req.user.role === 'LIC') {
      const existing = await prisma.cliente.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.licId !== req.user.licId) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
    }
    const data = pick(req.body, CLI_FIELDS.filter(f => f !== 'licId'));
    if (data.cpf) {
      const cpf = formatCPF(data.cpf);
      if (!cpf) return res.status(400).json({ error: 'CPF inválido.' });
      data.cpf = cpf;
    }
    if (data.data) data.data = new Date(data.data);
    const cli = await prisma.cliente.update({ where: { id: req.params.id }, data });
    res.json(cli);
  } catch (err) { next(err); }
});

module.exports = router;
