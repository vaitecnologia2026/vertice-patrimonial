const express = require('express');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const VALID_STATUS = ['PENDENTE', 'ATIVO', 'REPROVADO', 'INATIVO'];
const VALID_TIPO_COMISSAO = ['PERCENTUAL', 'FIXO'];
const VALID_REGRA = ['INDICACAO', 'VENDA', 'COMISSAO_RECEBIDA'];
const PARC_FIELDS = ['nome', 'whatsapp', 'email', 'documento', 'pix', 'banco', 'contratoUrl', 'contratoNome', 'cidade', 'estado', 'tipoAtuacao', 'prodInteresse'];

function gerarSlug() {
  return 'p_' + crypto.randomBytes(5).toString('hex');
}

// ─── LIST ────────────────────────────────────────────────────
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
      ];
    }
    const list = await prisma.parceiro.findMany({
      where,
      include: {
        licenciado: { select: { id: true, nome: true } },
        _count: { select: { leads: true, payouts: true, clientes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

// ─── DETAIL ──────────────────────────────────────────────────
router.get('/:id', auth, async (req, res, next) => {
  try {
    const parc = await prisma.parceiro.findUnique({
      where: { id: req.params.id },
      include: { licenciado: { select: { id: true, nome: true } } },
    });
    if (!parc) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && parc.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    res.json(parc);
  } catch (err) { next(err); }
});

// ─── CREATE MANUAL (entra direto ATIVO) ──────────────────────
router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, PARC_FIELDS);
    if (!data.nome || !data.whatsapp || !data.email || !data.documento) {
      return res.status(400).json({ error: 'nome, whatsapp, email e documento são obrigatórios.' });
    }
    const licId = req.user.role === 'LIC' ? req.user.licId : (req.body.licId || null);
    if (!licId) return res.status(400).json({ error: 'licId é obrigatório.' });

    const tipoComissao = String(req.body.tipoComissao || 'PERCENTUAL').toUpperCase();
    if (!VALID_TIPO_COMISSAO.includes(tipoComissao)) {
      return res.status(400).json({ error: 'tipoComissao inválido.' });
    }
    const regraComissao = req.body.regraComissao
      ? String(req.body.regraComissao).toUpperCase()
      : null;
    if (regraComissao && !VALID_REGRA.includes(regraComissao)) {
      return res.status(400).json({ error: 'regraComissao inválido.' });
    }

    const parc = await prisma.parceiro.create({
      data: {
        ...data,
        licId,
        tipoComissao,
        valComissao: parseFloat(req.body.valComissao) || 0,
        regraComissao,
        status: 'ATIVO',
        origem: 'manual',
        slugLp: gerarSlug(),
        approvedAt: new Date(),
        approvedBy: req.user.email,
      },
    });

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'PARCEIRO_CRIADO', entity: 'Parceiro', entityId: parc.id, desc: `Parceiro ${parc.nome} criado manualmente`, ip: req.ip },
    });

    res.status(201).json(parc);
  } catch (err) { next(err); }
});

// ─── UPDATE (dados gerais) ───────────────────────────────────
router.put('/:id', auth, async (req, res, next) => {
  try {
    const existing = await prisma.parceiro.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const data = pick(req.body, PARC_FIELDS);
    const parc = await prisma.parceiro.update({ where: { id: existing.id }, data });
    res.json(parc);
  } catch (err) { next(err); }
});

// ─── APROVAR (define remuneração + regra) ────────────────────
router.patch('/:id/aprovar', auth, async (req, res, next) => {
  try {
    const existing = await prisma.parceiro.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const tipoComissao = String(req.body.tipoComissao || '').toUpperCase();
    if (!VALID_TIPO_COMISSAO.includes(tipoComissao)) {
      return res.status(400).json({ error: 'tipoComissao obrigatório (PERCENTUAL ou FIXO).' });
    }
    const valComissao = parseFloat(req.body.valComissao);
    if (isNaN(valComissao) || valComissao < 0) {
      return res.status(400).json({ error: 'valComissao inválido.' });
    }
    const regraComissao = String(req.body.regraComissao || '').toUpperCase();
    if (!VALID_REGRA.includes(regraComissao)) {
      return res.status(400).json({ error: 'regraComissao obrigatório (INDICACAO, VENDA, COMISSAO_RECEBIDA).' });
    }

    const parc = await prisma.parceiro.update({
      where: { id: existing.id },
      data: {
        status: 'ATIVO',
        tipoComissao,
        valComissao,
        regraComissao,
        approvedAt: new Date(),
        approvedBy: req.user.email,
        slugLp: existing.slugLp || gerarSlug(),
      },
    });

    await prisma.auditoria.create({
      data: {
        userId: req.user.id, action: 'PARCEIRO_APROVADO', entity: 'Parceiro', entityId: parc.id,
        desc: `Parceiro ${parc.nome} aprovado · ${tipoComissao} ${valComissao} · regra ${regraComissao}`,
        ip: req.ip,
      },
    });

    res.json(parc);
  } catch (err) { next(err); }
});

// ─── REPROVAR ────────────────────────────────────────────────
router.patch('/:id/reprovar', auth, async (req, res, next) => {
  try {
    const existing = await prisma.parceiro.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const motivo = req.body.motivo ? String(req.body.motivo).slice(0, 500) : null;

    const parc = await prisma.parceiro.update({
      where: { id: existing.id },
      data: {
        status: 'REPROVADO',
        rejectedAt: new Date(),
        rejectedBy: req.user.email,
        rejectMotivo: motivo,
      },
    });

    await prisma.auditoria.create({
      data: {
        userId: req.user.id, action: 'PARCEIRO_REPROVADO', entity: 'Parceiro', entityId: parc.id,
        desc: `Parceiro ${parc.nome} reprovado${motivo ? ' · ' + motivo : ''}`,
        ip: req.ip,
      },
    });

    res.json(parc);
  } catch (err) { next(err); }
});

// ─── STATUS GENÉRICO (ativar/desativar) ──────────────────────
router.patch('/:id/status', auth, async (req, res, next) => {
  try {
    const existing = await prisma.parceiro.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const s = String(req.body.status || '').toUpperCase();
    if (!VALID_STATUS.includes(s)) return res.status(400).json({ error: 'status inválido.' });
    const parc = await prisma.parceiro.update({ where: { id: existing.id }, data: { status: s } });
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
