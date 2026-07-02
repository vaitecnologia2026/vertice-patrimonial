const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const OP_FIELDS = [
  'tipo', 'cliId', 'licId', 'status',
  'end', 'bairro', 'cidade', 'tipo_imovel', 'modalidade', 'leilao', 'lance', 'aval', 'deb', 'ref', 'mes',
  'valImovel', 'valSolicit', 'prazo', 'taxa',
  'banco', 'contratoCodigo', 'dataContrato', 'motivo', 'economia',
  'grupo', 'cota', 'parcelas', 'parcelaPagas', 'valorMensal', 'assembleia', 'cl', 'msgs', 'resp',
];

router.get('/', auth, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.tipo) where.tipo = req.query.tipo;
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (req.query.licId) where.licId = req.query.licId;
    if (req.query.status) where.status = req.query.status;
    const list = await prisma.operacao.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(list);
  } catch (err) { next(err); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const op = await prisma.operacao.findUniqueOrThrow({ where: { id: req.params.id } });
    if (req.user.role === 'LIC' && op.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    res.json(op);
  } catch (err) { next(err); }
});

// Helper: valida que cliId pertence ao mesmo licId
async function assertClienteOwnership(cliId, licId) {
  if (!cliId) return true;
  const c = await prisma.cliente.findUnique({ where: { id: cliId }, select: { licId: true } });
  return !!c && c.licId === licId;
}

router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, OP_FIELDS);
    data.licId = req.user.role === 'LIC' ? req.user.licId : data.licId;
    // Bloqueia cross-tenant: cliId referenciado precisa pertencer ao mesmo licId
    if (data.cliId && !await assertClienteOwnership(data.cliId, data.licId)) {
      return res.status(403).json({ error: 'Cliente não pertence a esta licença.' });
    }
    if (data.leilao) data.leilao = new Date(data.leilao);
    if (data.dataContrato) data.dataContrato = new Date(data.dataContrato);
    if (data.assembleia) data.assembleia = new Date(data.assembleia);
    res.status(201).json(await prisma.operacao.create({ data }));
  } catch (err) { next(err); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const existing = await prisma.operacao.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Operação não encontrada.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const data = pick(req.body, OP_FIELDS.filter(f => f !== 'tipo'));
    // Trocar cliId pra cliente de outro tenant é bloqueado
    if (data.cliId && !await assertClienteOwnership(data.cliId, existing.licId)) {
      return res.status(403).json({ error: 'Cliente não pertence a esta licença.' });
    }
    if (data.leilao) data.leilao = new Date(data.leilao);
    if (data.dataContrato) data.dataContrato = new Date(data.dataContrato);
    if (data.assembleia) data.assembleia = new Date(data.assembleia);
    res.json(await prisma.operacao.update({ where: { id: req.params.id }, data }));
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    const VALID_STATUS = ['em_analise', 'em_andamento', 'concluida', 'cancelada'];
    if (!VALID_STATUS.includes(req.body.status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const op = await prisma.operacao.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    await prisma.auditoria.create({ data: { userId: req.user.id, action: 'OPERACAO_STATUS', entityId: op.id, desc: `Status → ${op.status}`, ip: req.ip } });
    res.json(op);
  } catch (err) { next(err); }
});

module.exports = router;
