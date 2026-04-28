const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const GRUPO_FIELDS = ['codigo', 'nomeAdmin', 'totalCotas', 'parcelaMensal', 'prazoMeses', 'dataInicio', 'proxAssembleia', 'status'];

// ─── GRUPOS ──────────────────────────────────────────────────

// GET /api/clube/grupos
router.get('/grupos', auth, async (req, res, next) => {
  try {
    const grupos = await prisma.grupoClube.findMany({ orderBy: { codigo: 'asc' } });
    // Para cada grupo: contar cotas vendidas (Operacoes do tipo CLUBE com grupo=codigo)
    const withCotas = await Promise.all(grupos.map(async g => {
      const cotas = await prisma.operacao.findMany({
        where: { tipo: 'CLUBE', grupo: g.codigo ? parseInt(g.codigo.replace(/\D/g,''))||null : null },
        select: { id: true, cota: true, cliId: true, licId: true },
      });
      return { ...g, cotasVendidas: cotas.length, cotas };
    }));
    res.json(withCotas);
  } catch (err) { next(err); }
});

// POST /api/clube/grupos
router.post('/grupos', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, GRUPO_FIELDS);
    if (!data.codigo) return res.status(400).json({ error: 'codigo é obrigatório.' });
    if (!data.nomeAdmin) return res.status(400).json({ error: 'nomeAdmin é obrigatório.' });
    if (data.parcelaMensal == null) return res.status(400).json({ error: 'parcelaMensal é obrigatória.' });
    if (!data.dataInicio) return res.status(400).json({ error: 'dataInicio é obrigatória.' });

    data.parcelaMensal = parseFloat(data.parcelaMensal);
    if (data.totalCotas) data.totalCotas = parseInt(data.totalCotas);
    if (data.prazoMeses) data.prazoMeses = parseInt(data.prazoMeses);
    data.dataInicio = new Date(data.dataInicio);
    if (data.proxAssembleia) data.proxAssembleia = new Date(data.proxAssembleia);

    const grupo = await prisma.grupoClube.create({ data });
    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'CLUBE_GRUPO_CRIADO', entityId: grupo.id, desc: `Grupo ${grupo.codigo} criado (${grupo.totalCotas} cotas)`, ip: req.ip },
    });
    res.status(201).json(grupo);
  } catch (err) { next(err); }
});

// PUT /api/clube/grupos/:id
router.put('/grupos/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, GRUPO_FIELDS.filter(f => f !== 'codigo'));
    if (data.parcelaMensal != null) data.parcelaMensal = parseFloat(data.parcelaMensal);
    if (data.totalCotas != null) data.totalCotas = parseInt(data.totalCotas);
    if (data.prazoMeses != null) data.prazoMeses = parseInt(data.prazoMeses);
    if (data.dataInicio) data.dataInicio = new Date(data.dataInicio);
    if (data.proxAssembleia) data.proxAssembleia = new Date(data.proxAssembleia);
    const grupo = await prisma.grupoClube.update({ where: { id: req.params.id }, data });
    res.json(grupo);
  } catch (err) { next(err); }
});

// DELETE /api/clube/grupos/:id
router.delete('/grupos/:id', auth, adminOnly, async (req, res, next) => {
  try {
    await prisma.grupoClube.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── COTAS (Operações tipo=CLUBE) ────────────────────────────

// POST /api/clube/cotas — cria cota num grupo (cria Operacao CLUBE)
router.post('/cotas', auth, adminOnly, async (req, res, next) => {
  try {
    const { grupoCodigo, cota, cliId, licId, parcelas, parcelaPagas, valorMensal, assembleia } = req.body;
    if (!grupoCodigo) return res.status(400).json({ error: 'grupoCodigo é obrigatório.' });
    if (cota == null) return res.status(400).json({ error: 'cota é obrigatória.' });
    if (!cliId) return res.status(400).json({ error: 'cliId é obrigatório.' });

    const grupoNum = parseInt(String(grupoCodigo).replace(/\D/g, '')) || null;

    // Evitar duplicidade: cota+grupo já existe
    if (grupoNum != null) {
      const dup = await prisma.operacao.findFirst({
        where: { tipo: 'CLUBE', grupo: grupoNum, cota: parseInt(cota) },
      });
      if (dup) return res.status(400).json({ error: `Cota ${cota} já vendida no grupo ${grupoCodigo}.` });
    }

    const op = await prisma.operacao.create({
      data: {
        tipo: 'CLUBE',
        cliId,
        licId,
        grupo: grupoNum,
        cota: parseInt(cota),
        parcelas: parcelas ? parseInt(parcelas) : 48,
        parcelaPagas: parcelaPagas ? parseInt(parcelaPagas) : 0,
        valorMensal: valorMensal ? parseFloat(valorMensal) : null,
        assembleia: assembleia ? new Date(assembleia) : null,
      },
    });

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'CLUBE_COTA_CRIADA', entityId: op.id, desc: `Cota ${cota} no grupo ${grupoCodigo}`, ip: req.ip },
    });

    res.status(201).json(op);
  } catch (err) { next(err); }
});

module.exports = router;
