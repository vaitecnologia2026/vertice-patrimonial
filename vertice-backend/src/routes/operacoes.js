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

router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, OP_FIELDS);
    const VALID_TIPOS = ['ARREMATA', 'HOMEEQUITY', 'REVISAO', 'CLUBE'];
    if (!data.tipo || !VALID_TIPOS.includes(data.tipo)) {
      return res.status(400).json({ error: 'tipo é obrigatório e deve ser: ' + VALID_TIPOS.join(', ') });
    }
    if (!data.cliId) return res.status(400).json({ error: 'cliId é obrigatório.' });
    data.licId = req.user.role === 'LIC' ? req.user.licId : data.licId;
    if (data.lance) data.lance = parseFloat(data.lance);
    if (data.aval) data.aval = parseFloat(data.aval);
    if (data.deb) data.deb = parseFloat(data.deb);
    if (data.leilao) data.leilao = new Date(data.leilao);
    if (data.dataContrato) data.dataContrato = new Date(data.dataContrato);
    if (data.assembleia) data.assembleia = new Date(data.assembleia);
    res.status(201).json(await prisma.operacao.create({ data }));
  } catch (err) { next(err); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    // Verificar ownership para LIC
    if (req.user.role === 'LIC') {
      const existing = await prisma.operacao.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.licId !== req.user.licId) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
    }
    const data = pick(req.body, OP_FIELDS.filter(f => f !== 'tipo'));
    if (data.leilao) data.leilao = new Date(data.leilao);
    if (data.dataContrato) data.dataContrato = new Date(data.dataContrato);
    if (data.assembleia) data.assembleia = new Date(data.assembleia);
    res.json(await prisma.operacao.update({ where: { id: req.params.id }, data }));
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    const VALID_STATUS = ['em_analise', 'aprovado', 'reprovado', 'concluido', 'cancelado', 'pendente'];
    if (!req.body.status || !VALID_STATUS.includes(req.body.status)) {
      return res.status(400).json({ error: 'Status inválido. Valores: ' + VALID_STATUS.join(', ') });
    }
    const op = await prisma.operacao.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    await prisma.auditoria.create({ data: { userId: req.user.id, action: 'OPERACAO_STATUS', entityId: op.id, desc: `Status → ${op.status}`, ip: req.ip } });
    res.json(op);
  } catch (err) { next(err); }
});

module.exports = router;
