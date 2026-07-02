const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const CONS_FIELDS = ['tipo', 'nome', 'admin', 'carta', 'prazo', 'parcela', 'taxa', 'comissao', 'tabela', 'visivel', 'status'];

router.get('/', auth, async (req, res, next) => {
  try {
    const where = req.user.role === 'LIC' ? { visivel: true } : {};
    if (req.query.tipo) where.tipo = req.query.tipo;
    res.json(await prisma.consorcio.findMany({ where, orderBy: { createdAt: 'desc' } }));
  } catch (err) { next(err); }
});

router.post('/', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, CONS_FIELDS);
    data.status = 'aprovado';
    if (!data.nome || !data.tipo) return res.status(400).json({ error: 'nome e tipo são obrigatórios.' });
    res.status(201).json(await prisma.consorcio.create({ data }));
  } catch (err) { next(err); }
});

router.put('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, CONS_FIELDS);
    res.json(await prisma.consorcio.update({ where: { id: req.params.id }, data }));
  } catch (err) { next(err); }
});

router.patch('/:id/visibilidade', auth, adminOnly, async (req, res, next) => {
  try {
    res.json(await prisma.consorcio.update({ where: { id: req.params.id }, data: { visivel: !!req.body.visivel } }));
  } catch (err) { next(err); }
});

router.delete('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    await prisma.consorcio.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
