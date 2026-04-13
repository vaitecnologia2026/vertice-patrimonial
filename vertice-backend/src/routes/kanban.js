const express = require('express');
const prisma = require('../utils/prisma');
const { auth } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try {
    const where = req.user.role === 'LIC' ? { licId: req.user.licId } : {};
    const cards = await prisma.kanbanCard.findMany({
      where,
      include: { cliente: { select: { nome: true, cpf: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    // Agrupar por coluna
    const cols = {};
    cards.forEach(c => { if (!cols[c.col]) cols[c.col] = []; cols[c.col].push(c); });
    res.json(cols);
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, ['cliId', 'licId', 'col', 'prod', 'val', 'dias']);
    data.licId = req.user.role === 'LIC' ? req.user.licId : data.licId;
    if (!data.cliId || !data.licId) return res.status(400).json({ error: 'cliId é obrigatório.' });
    // Verificar que o cliente pertence ao licenciado
    if (req.user.role === 'LIC') {
      const cli = await prisma.cliente.findUnique({ where: { id: data.cliId } });
      if (!cli || cli.licId !== data.licId) return res.status(403).json({ error: 'Cliente não pertence a este licenciado.' });
    }
    const card = await prisma.kanbanCard.create({ data });
    res.status(201).json(card);
  } catch (err) { next(err); }
});

router.patch('/:id/move', auth, async (req, res, next) => {
  try {
    // Verificar ownership
    const existing = await prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Card não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const VALID_COLS = ['captado', 'em_analise', 'juridico', 'aprovado', 'lance_feito', 'arrematado', 'compra_direta', 'negociando', 'contrato', 'concluido'];
    if (!req.body.col || !VALID_COLS.includes(req.body.col)) {
      return res.status(400).json({ error: 'Coluna inválida.' });
    }
    const card = await prisma.kanbanCard.update({ where: { id: req.params.id }, data: { col: req.body.col } });
    res.json(card);
  } catch (err) { next(err); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    // Verificar ownership
    const existing = await prisma.kanbanCard.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Card não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    await prisma.kanbanCard.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
