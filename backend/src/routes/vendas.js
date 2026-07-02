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

    const vendas = await prisma.venda.findMany({
      where,
      include: {
        cliente: { select: { nome: true, cpf: true } },
        licenciado: { select: { nome: true } },
        comissoes: { select: { val: true, status: true } },
      },
      orderBy: { data: 'desc' },
    });
    res.json(vendas);
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
    data.val = parseFloat(data.val);
    if (isNaN(data.val) || data.val <= 0) {
      return res.status(400).json({ error: 'Valor inválido.' });
    }
    data.data = data.data ? new Date(data.data) : new Date();

    // Venda + comissão + auditoria numa transação (tudo ou nada — sem registro órfão).
    const venda = await prisma.$transaction(async (tx) => {
      const v = await tx.venda.create({ data });
      await calcularComissao(v, tx);
      await tx.auditoria.create({
        data: { userId: req.user.id, action: 'VENDA_CRIADA', entityId: v.id, desc: `Venda ${v.id} - ${v.prod}`, ip: req.ip },
      });
      return v;
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
    // Cancelar a venda cancela a(s) comissão(ões) vinculada(s) — senão ficam como
    // "a receber" fantasma nos KPIs (Contas a Receber, Financeiro, Dashboard).
    if (venda.status === 'CANCELADA') {
      await prisma.comissao.updateMany({
        where: { vendaId: venda.id, status: { not: 'CANCELADO' } },
        data: { status: 'CANCELADO' },
      });
    }
    res.json(venda);
  } catch (err) { next(err); }
});

// PUT /api/vendas/:id — edita a venda (recalcula a comissão PENDENTE se valor/produto mudar)
router.put('/:id', auth, async (req, res, next) => {
  try {
    const existing = await prisma.venda.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Venda não encontrada.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const data = pick(req.body, ['cliId', 'prod', 'val', 'canal', 'status', 'opId', 'data']);
    if (data.val != null) {
      data.val = parseFloat(data.val);
      if (isNaN(data.val) || data.val <= 0) return res.status(400).json({ error: 'Valor inválido.' });
    }
    if (data.status) data.status = String(data.status).toUpperCase();
    if (data.data) data.data = new Date(data.data);

    const venda = await prisma.venda.update({ where: { id: existing.id }, data });

    // Se o valor OU o produto mudou, recalcula a comissão PENDENTE (preserva as já PAGAS).
    const valorMudou = data.val != null && data.val !== existing.val;
    const prodMudou = data.prod && data.prod !== existing.prod;
    if (valorMudou || prodMudou) {
      await prisma.$transaction(async (tx) => {
        await tx.comissao.deleteMany({ where: { vendaId: venda.id, status: 'PENDENTE' } });
        await calcularComissao(venda, tx);
      });
    }
    res.json(venda);
  } catch (err) { next(err); }
});

// DELETE /api/vendas/:id — remove a venda (bloqueia se já há comissão PAGA; limpa comissões + contrato)
router.delete('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const existing = await prisma.venda.findUnique({
      where: { id: req.params.id },
      include: { comissoes: { select: { status: true } }, contrato: { select: { id: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Venda não encontrada.' });
    if (existing.comissoes.some((c) => c.status === 'PAGO')) {
      return res.status(409).json({ error: 'Não é possível excluir: há comissão já paga nesta venda.' });
    }
    await prisma.comissao.deleteMany({ where: { vendaId: existing.id } });
    if (existing.contrato) await prisma.contrato.delete({ where: { id: existing.contrato.id } });
    await prisma.venda.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── MOTOR DE COMISSÃO (parametrizável pela Central de Configurações) ─────────
// Estes são os valores DE FÁBRICA — idênticos ao que o sistema sempre usou. Se o
// admin configurar `business.comissao` na Central, eles são sobrescritos. Em
// qualquer ausência/erro de config, o cálculo é EXATAMENTE o de antes (zero regressão).
const DEFAULT_COMISSAO = {
  arremata:   { faixa1: 500000, faixa2: 1000000, pct1: 0.06, pct2: 0.08, pct3: 0.10, pctLic: 0.30 },
  homeequity: { pct: 0.015, pctLic: 0.35 },
  revisao:    { pct: 0.20, pctLic: 0.25 },
  clube:      { pct: 0.20, licFixo: 150 },
  pctAdv: 0.05,
  pctAna: 0.05,
};

const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pctTxt = (f) => String(Math.round(f * 10000) / 100); // 0.015 → "1.5", 0.3 → "30"

// Lê os parâmetros de comissão da Central, mesclados com os defaults. Nunca lança.
async function loadComissaoParams() {
  try {
    const cfg = await prisma.configuracao.findFirst();
    const c = cfg && cfg.business && typeof cfg.business === 'object' ? cfg.business.comissao : null;
    if (!c || typeof c !== 'object') return DEFAULT_COMISSAO;
    const D = DEFAULT_COMISSAO, a = c.arremata || {}, h = c.homeequity || {}, r = c.revisao || {}, k = c.clube || {};
    return {
      arremata: {
        faixa1: numOr(a.faixa1, D.arremata.faixa1), faixa2: numOr(a.faixa2, D.arremata.faixa2),
        pct1: numOr(a.pct1, D.arremata.pct1), pct2: numOr(a.pct2, D.arremata.pct2),
        pct3: numOr(a.pct3, D.arremata.pct3), pctLic: numOr(a.pctLic, D.arremata.pctLic),
      },
      homeequity: { pct: numOr(h.pct, D.homeequity.pct), pctLic: numOr(h.pctLic, D.homeequity.pctLic) },
      revisao:    { pct: numOr(r.pct, D.revisao.pct), pctLic: numOr(r.pctLic, D.revisao.pctLic) },
      clube:      { pct: numOr(k.pct, D.clube.pct), licFixo: numOr(k.licFixo, D.clube.licFixo) },
      pctAdv: numOr(c.pctAdv, D.pctAdv), pctAna: numOr(c.pctAna, D.pctAna),
    };
  } catch {
    return DEFAULT_COMISSAO;
  }
}

// Calcular comissão automaticamente por produto
async function calcularComissao(venda, db = prisma) {
  const P = await loadComissaoParams();
  let comEmpresa = 0, valLic = 0, regra = '';

  if (venda.prod.includes('Arrematação')) {
    const A = P.arremata;
    const pct = venda.val >= A.faixa2 ? A.pct3 : venda.val >= A.faixa1 ? A.pct2 : A.pct1;
    comEmpresa = venda.val * pct;
    valLic = comEmpresa * A.pctLic;
    regra = `${pctTxt(pct)}% empresa → ${pctTxt(A.pctLic)}% licenciado`;
  } else if (venda.prod.includes('Home Equity')) {
    comEmpresa = venda.val * P.homeequity.pct;
    valLic = comEmpresa * P.homeequity.pctLic;
    regra = `${pctTxt(P.homeequity.pct)}% sobre valor → ${pctTxt(P.homeequity.pctLic)}% licenciado`;
  } else if (venda.prod.includes('Revisão')) {
    comEmpresa = venda.val * P.revisao.pct;
    valLic = comEmpresa * P.revisao.pctLic;
    regra = `${pctTxt(P.revisao.pct)}% da economia → ${pctTxt(P.revisao.pctLic)}% licenciado`;
  } else if (venda.prod.includes('Clube')) {
    comEmpresa = venda.val * P.clube.pct;
    valLic = P.clube.licFixo;
    regra = `R$${P.clube.licFixo}/mês fixo`;
  }

  if (comEmpresa > 0) {
    const comAdv = valLic * P.pctAdv;
    const comAna = valLic * P.pctAna;
    const netEmpresa = comEmpresa - valLic - comAdv - comAna;
    // Clube é recorrente: persiste a projeção (36 meses + bônus) p/ os KPIs de
    // "Recorrente/mês" e "Total projetado" baterem (antes ficavam zerados/no presente).
    const isClube = venda.prod.includes('Clube');
    await db.comissao.create({
      data: {
        vendaId: venda.id, licId: venda.licId, prod: venda.prod,
        valNeg: venda.val, regra, comEmpresa, val: valLic,
        comAdv, comAna, netEmpresa,
        recorrente: isClube,
        totalFuturo: isClube ? (valLic * 36 + 2000) : null,
      },
    });
  }
}

module.exports = router;
