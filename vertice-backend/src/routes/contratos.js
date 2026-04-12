const express = require('express');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try {
    const where = req.query.licId ? { venda: { licId: req.query.licId } } : {};
    if (req.user.role === 'LIC') where.venda = { ...where.venda, licId: req.user.licId };
    const list = await prisma.contrato.findMany({
      where,
      include: { venda: { include: { cliente: { select: { nome: true } }, licenciado: { select: { nome: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

router.post('/', auth, adminOnly, async (req, res, next) => {
  try {
    const { vendaId, tipo } = req.body;
    if (!vendaId || !tipo) return res.status(400).json({ error: 'vendaId e tipo são obrigatórios.' });

    const lastContrato = await prisma.contrato.findFirst({ orderBy: { createdAt: 'desc' } });
    const lastHash = lastContrato?.hash || '0'.repeat(64);
    const data = { numero: `CTR-${Date.now()}`, vendaId, tipo };
    const hash = crypto.createHash('sha256').update(JSON.stringify(data) + lastHash).digest('hex');
    const contrato = await prisma.contrato.create({ data: { ...data, hash, hashPrev: lastHash } });

    await prisma.auditoria.create({
      data: {
        userId: req.user.id, action: 'CONTRATO_GERADO', entityId: contrato.id,
        desc: `Contrato ${contrato.numero} - SHA256: ${hash.slice(0, 8)}...${hash.slice(-4)}`, ip: req.ip,
      },
    });
    res.status(201).json(contrato);
  } catch (err) { next(err); }
});

router.patch('/:id/assinar', auth, async (req, res, next) => {
  try {
    // Verificar se o contrato pertence ao usuário
    const existing = await prisma.contrato.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { venda: { select: { licId: true } } },
    });
    if (req.user.role === 'LIC' && existing.venda.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const contrato = await prisma.contrato.update({
      where: { id: req.params.id },
      data: { status: 'ASSINADO', dataAss: new Date() },
    });
    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'CONTRATO_ASSINADO', entityId: contrato.id, desc: `Contrato ${contrato.numero} assinado`, ip: req.ip },
    });
    res.json(contrato);
  } catch (err) { next(err); }
});

module.exports = router;
