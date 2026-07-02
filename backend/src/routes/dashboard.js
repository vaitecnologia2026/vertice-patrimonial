const express = require('express');
const prisma = require('../utils/prisma');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try {
    const licFilter = req.user.role === 'LIC' ? { licId: req.user.licId } : {};

    const [totalLics, totalCli, totalVendas, vendas, comissoes, pendentes, pipeline] = await Promise.all([
      req.user.role === 'ADMIN' ? prisma.licenciado.count({ where: { status: 'ATIVO' } }) : Promise.resolve(null),
      prisma.cliente.count({ where: licFilter }),
      prisma.venda.count({ where: { ...licFilter, status: 'FECHADA' } }),
      prisma.venda.findMany({ where: { ...licFilter, status: 'FECHADA' }, select: { val: true, data: true, prod: true } }),
      prisma.comissao.aggregate({ _sum: { val: true }, where: { ...licFilter, status: 'PAGO' } }),
      prisma.comissao.aggregate({ _sum: { val: true }, where: { ...licFilter, status: 'PENDENTE' } }),
      prisma.operacao.groupBy({ by: ['status'], _count: { id: true }, where: licFilter }),
    ]);

    const volume = vendas.reduce((s, v) => s + v.val, 0);

    res.json({
      totalLicenciados: totalLics,
      totalClientes: totalCli,
      totalVendas,
      volume,
      comissoesPagas: comissoes._sum.val || 0,
      comissoesPendentes: pendentes._sum.val || 0,
      pipeline: pipeline.reduce((acc, p) => { acc[p.status] = p._count.id; return acc; }, {}),
    });
  } catch (err) { next(err); }
});

module.exports = router;
