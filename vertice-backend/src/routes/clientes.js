const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
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

    const clientes = await prisma.cliente.findMany({
      where,
      include: {
        licenciado: { select: { nome: true } },
        _count: { select: { vendas: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clientes);
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

// POST /api/clientes/:id/transferir — Admin transfere ownership do cliente para outro Licenciado
router.post('/:id/transferir', auth, adminOnly, async (req, res, next) => {
  try {
    const { licId, justificativa } = req.body;
    if (!licId) return res.status(400).json({ error: 'licId destino é obrigatório.' });
    if (!justificativa || justificativa.trim().length < 10) {
      return res.status(400).json({ error: 'Justificativa é obrigatória (mínimo 10 caracteres).' });
    }
    const cli = await prisma.cliente.findUnique({ where: { id: req.params.id } });
    if (!cli) return res.status(404).json({ error: 'Cliente não encontrado.' });
    const destino = await prisma.licenciado.findUnique({ where: { id: licId } });
    if (!destino) return res.status(400).json({ error: 'Licenciado destino inválido.' });
    if (cli.licId === licId) {
      return res.status(400).json({ error: 'Cliente já pertence a este licenciado.' });
    }
    const ownerOrigem = cli.licId;
    const updated = await prisma.cliente.update({
      where: { id: cli.id },
      data: { licId },
    });
    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'CLIENTE_TRANSFER',
        entity: 'Cliente',
        entityId: cli.id,
        desc: `Cliente ${cli.nome} (CPF ${cli.cpf}) transferido de ${ownerOrigem} para ${licId}. Motivo: ${justificativa.trim()}`,
        ip: req.ip,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
