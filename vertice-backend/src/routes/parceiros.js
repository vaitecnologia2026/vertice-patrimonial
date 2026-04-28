const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick, formatCPF, formatCNPJ } = require('../utils/sanitize');

const router = express.Router();

const PARC_FIELDS = [
  'nome', 'whatsapp', 'email', 'documento',
  'cidade', 'estado', 'tipoAtuacao', 'prodInteresse', 'observacao',
  'tipoComissao', 'valComissao', 'status', 'licId',
];

const VALID_TIPO_COM = ['FIXO', 'PERCENTUAL'];
const VALID_STATUS   = ['ATIVO', 'INATIVO'];

// Sanitiza documento aceitando CPF ou CNPJ. Retorna formatado ou null se inválido.
function normalizeDocumento(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11) return formatCPF(digits);
  if (digits.length === 14) return formatCNPJ(digits);
  return null;
}

// ─── LIST ────────────────────────────────────────────────────
// LIC vê apenas os próprios; ADMIN vê todos (com filtro opcional por licId).
router.get('/', auth, async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (req.query.licId) where.licId = req.query.licId;

    if (req.query.status) {
      const s = String(req.query.status).toUpperCase();
      if (VALID_STATUS.includes(s)) where.status = s;
    }
    if (req.query.q) {
      const q = req.query.q;
      where.OR = [
        { nome:      { contains: q, mode: 'insensitive' } },
        { email:     { contains: q, mode: 'insensitive' } },
        { whatsapp:  { contains: q } },
        { documento: { contains: q } },
        { cidade:    { contains: q, mode: 'insensitive' } },
      ];
    }

    const list = await prisma.parceiro.findMany({
      where,
      include: { licenciado: { select: { id: true, nome: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

// ─── DETAIL ──────────────────────────────────────────────────
router.get('/:id', auth, async (req, res, next) => {
  try {
    const p = await prisma.parceiro.findUnique({
      where: { id: req.params.id },
      include: { licenciado: { select: { id: true, nome: true } } },
    });
    if (!p) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && p.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    res.json(p);
  } catch (err) { next(err); }
});

// ─── CREATE (manual, dentro do CRM) ──────────────────────────
router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, PARC_FIELDS);

    // LIC só pode cadastrar para si; Admin pode escolher licId
    if (req.user.role === 'LIC') data.licId = req.user.licId;
    if (!data.licId) return res.status(400).json({ error: 'licId é obrigatório.' });

    if (!data.nome || !data.nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!data.whatsapp || !data.whatsapp.trim()) return res.status(400).json({ error: 'WhatsApp é obrigatório.' });
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return res.status(400).json({ error: 'E-mail inválido.' });

    const doc = normalizeDocumento(data.documento);
    if (!doc) return res.status(400).json({ error: 'CPF ou CNPJ inválido.' });
    data.documento = doc;

    if (data.tipoComissao) {
      const t = String(data.tipoComissao).toUpperCase();
      if (!VALID_TIPO_COM.includes(t)) return res.status(400).json({ error: 'tipoComissao inválido.' });
      data.tipoComissao = t;
    }
    if (data.status) {
      const s = String(data.status).toUpperCase();
      if (!VALID_STATUS.includes(s)) return res.status(400).json({ error: 'status inválido.' });
      data.status = s;
    }
    if (data.valComissao != null) {
      const v = parseFloat(data.valComissao);
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'valComissao inválido.' });
      data.valComissao = v;
    }

    data.origem = 'manual';

    const parc = await prisma.parceiro.create({
      data,
      include: { licenciado: { select: { id: true, nome: true } } },
    });

    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'PARCEIRO_CRIADO',
        entity: 'Parceiro',
        entityId: parc.id,
        desc: `Parceiro ${parc.nome} cadastrado (manual) para licenciado ${parc.licId}`,
        ip: req.ip,
      },
    });

    res.status(201).json(parc);
  } catch (err) { next(err); }
});

// ─── UPDATE ──────────────────────────────────────────────────
router.put('/:id', auth, async (req, res, next) => {
  try {
    const existing = await prisma.parceiro.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // LIC não pode trocar o licId do parceiro; Admin pode
    const allowed = req.user.role === 'LIC'
      ? PARC_FIELDS.filter(f => f !== 'licId')
      : PARC_FIELDS;
    const data = pick(req.body, allowed);

    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }
    if (data.documento) {
      const doc = normalizeDocumento(data.documento);
      if (!doc) return res.status(400).json({ error: 'CPF ou CNPJ inválido.' });
      data.documento = doc;
    }
    if (data.tipoComissao) {
      const t = String(data.tipoComissao).toUpperCase();
      if (!VALID_TIPO_COM.includes(t)) return res.status(400).json({ error: 'tipoComissao inválido.' });
      data.tipoComissao = t;
    }
    if (data.status) {
      const s = String(data.status).toUpperCase();
      if (!VALID_STATUS.includes(s)) return res.status(400).json({ error: 'status inválido.' });
      data.status = s;
    }
    if (data.valComissao != null) {
      const v = parseFloat(data.valComissao);
      if (isNaN(v) || v < 0) return res.status(400).json({ error: 'valComissao inválido.' });
      data.valComissao = v;
    }

    const parc = await prisma.parceiro.update({
      where: { id: existing.id },
      data,
      include: { licenciado: { select: { id: true, nome: true } } },
    });

    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'PARCEIRO_ATUALIZADO',
        entity: 'Parceiro',
        entityId: parc.id,
        desc: `Parceiro ${parc.nome} atualizado`,
        ip: req.ip,
      },
    });

    res.json(parc);
  } catch (err) { next(err); }
});

// ─── TOGGLE STATUS ───────────────────────────────────────────
router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    const existing = await prisma.parceiro.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const novo = String(req.body.status || '').toUpperCase();
    if (!VALID_STATUS.includes(novo)) return res.status(400).json({ error: 'status inválido.' });

    const parc = await prisma.parceiro.update({
      where: { id: existing.id },
      data: { status: novo },
    });

    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'PARCEIRO_STATUS',
        entity: 'Parceiro',
        entityId: parc.id,
        desc: `Status do parceiro ${parc.nome} → ${parc.status}`,
        ip: req.ip,
      },
    });

    res.json(parc);
  } catch (err) { next(err); }
});

// ─── DELETE (admin) ──────────────────────────────────────────
router.delete('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    await prisma.parceiro.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
