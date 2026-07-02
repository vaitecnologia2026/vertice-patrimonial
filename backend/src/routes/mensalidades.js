const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// MENSALIDADES / ASSINATURAS DA LICENÇA
// Cobrança recorrente da licença (taxa de manutenção). O admin cadastra uma
// assinatura por licenciado, "gera" as parcelas do mês (idempotente por
// competência AAAA-MM) e dá baixa quando recebe. LIC enxerga só as próprias.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATUS = ['ATIVA', 'SUSPENSA', 'CANCELADA'];
const VALID_PARCELA = ['PENDENTE', 'PAGA', 'CANCELADA'];

// ─── ASSINATURAS ─────────────────────────────────────────────────────────────

// GET /api/mensalidades — lista assinaturas (LIC vê só as suas)
router.get('/', auth, async (req, res, next) => {
  try {
    // Financeiro da licença: só ADMIN (todas) e LIC (as próprias). COLAB não acessa.
    if (req.user.role !== 'ADMIN' && req.user.role !== 'LIC') {
      return res.status(403).json({ error: 'Acesso restrito.' });
    }
    const where = req.user.role === 'LIC' ? { licId: req.user.licId } : {};
    const list = await prisma.mensalidade.findMany({
      where,
      include: { licenciado: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

// GET /api/mensalidades/resumo — KPIs agregados NO SERVIDOR (não limitado a 500 parcelas).
// "recebidoMes" usa pagoEm (data real do pagamento), não a competência.
router.get('/resumo', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'LIC') {
      return res.status(403).json({ error: 'Acesso restrito.' });
    }
    const base = req.user.role === 'LIC' ? { licId: req.user.licId } : {};
    const now = new Date();
    const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);
    const inicioProx = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [mrr, pend, atras, receb] = await Promise.all([
      prisma.mensalidade.aggregate({ _sum: { valor: true }, where: { ...base, status: 'ATIVA' } }),
      prisma.parcela.aggregate({ _sum: { valor: true }, _count: true, where: { ...base, status: 'PENDENTE' } }),
      prisma.parcela.aggregate({ _sum: { valor: true }, _count: true, where: { ...base, status: 'PENDENTE', vencimento: { lt: now } } }),
      prisma.parcela.aggregate({ _sum: { valor: true }, where: { ...base, status: 'PAGA', pagoEm: { gte: inicioMes, lt: inicioProx } } }),
    ]);
    res.json({
      mrr: mrr._sum.valor || 0,
      aReceber: pend._sum.valor || 0,
      aReceberQtd: pend._count || 0,
      atrasado: atras._sum.valor || 0,
      atrasadoQtd: atras._count || 0,
      recebidoMes: receb._sum.valor || 0,
    });
  } catch (err) { next(err); }
});

// POST /api/mensalidades — cria assinatura
router.post('/', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['licId', 'descricao', 'valor', 'diaVenc', 'status', 'inicio']);
    if (!data.licId) return res.status(400).json({ error: 'Licenciado é obrigatório.' });
    data.valor = parseFloat(data.valor);
    if (!Number.isFinite(data.valor) || data.valor <= 0) {
      return res.status(400).json({ error: 'Valor inválido.' });
    }
    // dia 1–28 garante que a data existe em qualquer mês (inclusive fevereiro)
    data.diaVenc = Math.min(28, Math.max(1, parseInt(data.diaVenc, 10) || 10));
    if (data.status && !VALID_STATUS.includes(data.status)) delete data.status;
    if (data.inicio) data.inicio = new Date(data.inicio);
    if (!data.descricao) data.descricao = 'Mensalidade da licença';

    const created = await prisma.mensalidade.create({ data });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/mensalidades/:id — edita assinatura
router.put('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['descricao', 'valor', 'diaVenc', 'status']);
    if (data.valor != null) {
      data.valor = parseFloat(data.valor);
      if (!Number.isFinite(data.valor) || data.valor <= 0) {
        return res.status(400).json({ error: 'Valor inválido.' });
      }
    }
    if (data.diaVenc != null) data.diaVenc = Math.min(28, Math.max(1, parseInt(data.diaVenc, 10) || 10));
    if (data.status != null && !VALID_STATUS.includes(data.status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const updated = await prisma.mensalidade.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/mensalidades/:id — remove assinatura (e parcelas via cascade)
router.delete('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    await prisma.mensalidade.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── PARCELAS ────────────────────────────────────────────────────────────────

// GET /api/mensalidades/parcelas — lista parcelas (filtros: status, competencia)
router.get('/parcelas', auth, async (req, res, next) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'LIC') {
      return res.status(403).json({ error: 'Acesso restrito.' });
    }
    const where = {};
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    if (req.query.status) {
      const s = String(req.query.status).toUpperCase();
      if (VALID_PARCELA.includes(s)) where.status = s;
    }
    if (req.query.competencia) where.competencia = String(req.query.competencia);
    const list = await prisma.parcela.findMany({
      where,
      include: {
        mensalidade: { select: { descricao: true, licenciado: { select: { nome: true } } } },
      },
      orderBy: [{ vencimento: 'desc' }],
      take: 500,
    });
    res.json(list);
  } catch (err) { next(err); }
});

// POST /api/mensalidades/gerar — gera parcelas da competência (default: mês atual)
// Idempotente: a constraint única (mensalidadeId, competencia) evita duplicar.
router.post('/gerar', auth, adminOnly, async (req, res, next) => {
  try {
    const now = new Date();
    const comp = (req.body && req.body.competencia)
      || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const m = /^(\d{4})-(\d{2})$/.exec(comp);
    if (!m) return res.status(400).json({ error: 'Competência inválida (use AAAA-MM).' });
    const year = parseInt(m[1], 10), month = parseInt(m[2], 10);
    if (month < 1 || month > 12) return res.status(400).json({ error: 'Mês inválido.' });

    const ativas = await prisma.mensalidade.findMany({ where: { status: 'ATIVA' } });
    const lastDay = new Date(year, month, 0).getDate();
    let criadas = 0;
    for (const a of ativas) {
      const dia = Math.min(Math.max(1, a.diaVenc || 10), lastDay);
      const vencimento = new Date(year, month - 1, dia, 12, 0, 0); // meio-dia: evita virar o dia por timezone
      try {
        await prisma.parcela.create({
          data: { mensalidadeId: a.id, licId: a.licId, competencia: comp, valor: a.valor, vencimento },
        });
        criadas++;
      } catch (e) {
        if (!(e && e.code === 'P2002')) throw e; // P2002 = já existe parcela dessa competência → ok
      }
    }

    try {
      await prisma.auditoria.create({
        data: {
          userId: req.user.id, action: 'PARCELAS_GERADAS', entity: 'mensalidade',
          entityId: comp, desc: `Gerou ${criadas} parcela(s) da competência ${comp}`, ip: req.ip,
        },
      });
    } catch (_) { /* auditoria opcional */ }

    res.json({ ok: true, competencia: comp, criadas, assinaturasAtivas: ativas.length });
  } catch (err) { next(err); }
});

// PATCH /api/mensalidades/parcelas/:id/pagar — dá baixa
router.patch('/parcelas/:id/pagar', auth, adminOnly, async (req, res, next) => {
  try {
    const p = await prisma.parcela.update({
      where: { id: req.params.id },
      data: { status: 'PAGA', pagoEm: new Date() },
    });
    try {
      await prisma.auditoria.create({
        data: { userId: req.user.id, action: 'PARCELA_PAGA', entity: 'parcela', entityId: p.id, desc: `Parcela ${p.competencia} recebida`, ip: req.ip },
      });
    } catch (_) { /* opcional */ }
    res.json(p);
  } catch (err) { next(err); }
});

// PATCH /api/mensalidades/parcelas/:id/cancelar
router.patch('/parcelas/:id/cancelar', auth, adminOnly, async (req, res, next) => {
  try {
    const p = await prisma.parcela.update({
      where: { id: req.params.id },
      data: { status: 'CANCELADA' },
    });
    res.json(p);
  } catch (err) { next(err); }
});

module.exports = router;
