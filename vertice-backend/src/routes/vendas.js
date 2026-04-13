const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const VENDA_FIELDS = ['cliId', 'licId', 'prod', 'val', 'canal', 'status', 'comStatus', 'opId', 'data'];

// GET /api/vendas
router.get('/', auth, async (req, res, next) => {
  try {
    const { licId, status, prod, q } = req.query;
    const where = {};
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (licId) where.licId = licId;
    if (status) where.status = status.toUpperCase();
    if (prod) where.prod = { contains: prod, mode: 'insensitive' };
    if (q) where.OR = [
      { cliente: { nome: { contains: q, mode: 'insensitive' } } },
      { cliente: { cpf: { contains: q } } },
    ];

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [vendas, total] = await Promise.all([
      prisma.venda.findMany({
        where,
        include: {
          cliente: { select: { nome: true, cpf: true } },
          licenciado: { select: { nome: true } },
          comissoes: { select: { val: true, status: true } },
        },
        orderBy: { data: 'desc' },
        skip,
        take: limit,
      }),
      prisma.venda.count({ where }),
    ]);
    res.json({ data: vendas, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// GET /api/vendas/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const venda = await prisma.venda.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        cliente: true,
        licenciado: true,
        comissoes: true,
        contrato: true,
      },
    });
    // Verificar ownership para LIC
    if (req.user.role === 'LIC' && venda.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    res.json(venda);
  } catch (err) { next(err); }
});

// POST /api/vendas
router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, VENDA_FIELDS);
    data.licId = req.user.role === 'LIC' ? req.user.licId : data.licId;
    if (!data.licId || !data.cliId || !data.prod) {
      return res.status(400).json({ error: 'cliId, licId e prod são obrigatórios.' });
    }
    // Verificar que o cliente pertence ao licenciado
    if (req.user.role === 'LIC') {
      const cli = await prisma.cliente.findUnique({ where: { id: data.cliId } });
      if (!cli || cli.licId !== data.licId) {
        return res.status(403).json({ error: 'Cliente não pertence a este licenciado.' });
      }
    }
    data.val = parseFloat(data.val);
    if (isNaN(data.val) || data.val <= 0) {
      return res.status(400).json({ error: 'Valor inválido.' });
    }
    data.data = data.data ? new Date(data.data) : new Date();

    const venda = await prisma.venda.create({ data });

    // Auto-calcular comissão
    await calcularComissao(venda);

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'VENDA_CRIADA', entityId: venda.id, desc: `Venda ${venda.id} - ${venda.prod}`, ip: req.ip },
    });

    res.status(201).json(venda);
  } catch (err) { next(err); }
});

// PATCH /api/vendas/:id/status
router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    const validStatus = ['ABERTA', 'FECHADA', 'CANCELADA'];
    if (!validStatus.includes(req.body.status?.toUpperCase())) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const venda = await prisma.venda.update({
      where: { id: req.params.id },
      data: { status: req.body.status.toUpperCase() },
    });
    res.json(venda);
  } catch (err) { next(err); }
});

// Calcular comissão automaticamente por produto
async function calcularComissao(venda) {
  let comEmpresa = 0, valLic = 0, regra = '';

  if (venda.prod.includes('Arrematação')) {
    const pct = venda.val >= 1000000 ? 0.10 : venda.val >= 500000 ? 0.08 : 0.06;
    comEmpresa = venda.val * pct;
    valLic = comEmpresa * 0.30;
    regra = `${(pct * 100).toFixed(0)}% empresa → 30% licenciado`;
  } else if (venda.prod.includes('Home Equity')) {
    comEmpresa = venda.val * 0.015;
    valLic = comEmpresa * 0.35;
    regra = '1.5% sobre valor → 35% licenciado';
  } else if (venda.prod.includes('Revisão')) {
    comEmpresa = venda.val * 0.20;
    valLic = comEmpresa * 0.25;
    regra = '20% da economia → 25% licenciado';
  } else if (venda.prod.includes('Clube')) {
    comEmpresa = venda.val * 0.20;
    valLic = 150;
    regra = 'R$150/mês fixo';
  }

  if (comEmpresa > 0) {
    const comAdv = valLic * 0.05;
    const comAna = valLic * 0.05;
    const netEmpresa = comEmpresa - valLic - comAdv - comAna;
    await prisma.comissao.create({
      data: {
        vendaId: venda.id, licId: venda.licId, prod: venda.prod,
        valNeg: venda.val, regra, comEmpresa, val: valLic,
        comAdv, comAna, netEmpresa,
      },
    });
  }
}

module.exports = router;
