const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const CONTA_FIELDS = ['licId', 'descricao', 'valor', 'vencimento', 'status', 'obs'];
const VALID_STATUS = ['EM_DIA', 'FUTURO', 'EM_ATRASO', 'INADIMPLENTE', 'COBRANCA', 'PAGO'];

// GET /api/contas — Admin vê todas; LIC só as próprias
router.get('/', auth, async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (req.query.licId) where.licId = req.query.licId;
    if (req.query.status) {
      const s = req.query.status.toUpperCase();
      if (VALID_STATUS.includes(s)) where.status = s;
    }
    const list = await prisma.conta.findMany({
      where,
      include: { licenciado: { select: { id: true, nome: true } } },
      orderBy: { vencimento: 'asc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

// POST /api/contas — Admin cria conta
router.post('/', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, CONTA_FIELDS);
    if (!data.licId) return res.status(400).json({ error: 'licId é obrigatório.' });
    if (!data.descricao) return res.status(400).json({ error: 'descricao é obrigatória.' });
    if (data.valor == null || isNaN(parseFloat(data.valor))) {
      return res.status(400).json({ error: 'valor é obrigatório.' });
    }
    if (!data.vencimento) return res.status(400).json({ error: 'vencimento é obrigatório.' });
    data.valor = parseFloat(data.valor);
    data.vencimento = new Date(data.vencimento);
    if (data.status) {
      const s = data.status.toUpperCase();
      if (!VALID_STATUS.includes(s)) return res.status(400).json({ error: 'Status inválido.' });
      data.status = s;
    }
    const conta = await prisma.conta.create({ data });
    res.status(201).json(conta);
  } catch (err) { next(err); }
});

// PATCH /api/contas/:id — atualizar dados gerais
router.patch('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, CONTA_FIELDS.filter(f => f !== 'licId'));
    if (data.valor != null) data.valor = parseFloat(data.valor);
    if (data.vencimento) data.vencimento = new Date(data.vencimento);
    if (data.status) {
      const s = data.status.toUpperCase();
      if (!VALID_STATUS.includes(s)) return res.status(400).json({ error: 'Status inválido.' });
      data.status = s;
    }
    const conta = await prisma.conta.update({ where: { id: req.params.id }, data });
    res.json(conta);
  } catch (err) { next(err); }
});

// PATCH /api/contas/:id/pagar — marca como paga
router.patch('/:id/pagar', auth, adminOnly, async (req, res, next) => {
  try {
    const conta = await prisma.conta.update({
      where: { id: req.params.id },
      data: { status: 'PAGO', dataPagamento: new Date() },
      include: { licenciado: { select: { nome: true } } },
    });
    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'CONTA_PAGA',
        entity: 'Conta',
        entityId: conta.id,
        desc: `Conta paga: ${conta.descricao} · ${conta.licenciado?.nome} · R$${conta.valor}`,
        ip: req.ip,
      },
    });
    res.json(conta);
  } catch (err) { next(err); }
});

// PATCH /api/contas/:id/cobranca — registra envio de cobrança
router.patch('/:id/cobranca', auth, adminOnly, async (req, res, next) => {
  try {
    const { canal } = req.body; // 'email', 'whatsapp', 'sms'
    const conta = await prisma.conta.update({
      where: { id: req.params.id },
      data: { status: 'COBRANCA', dataCobranca: new Date() },
      include: { licenciado: { select: { nome: true } } },
    });
    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'CONTA_COBRANCA',
        entity: 'Conta',
        entityId: conta.id,
        desc: `Cobrança enviada${canal ? ' via ' + canal : ''}: ${conta.descricao} · ${conta.licenciado?.nome}`,
        ip: req.ip,
      },
    });
    res.json(conta);
  } catch (err) { next(err); }
});

// DELETE /api/contas/:id
router.delete('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    await prisma.conta.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
