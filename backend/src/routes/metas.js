const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try {
    const where = req.user.role === 'LIC' ? { licId: req.user.licId } : {};
    if (req.query.periodo) where.periodo = req.query.periodo;
    const list = await prisma.meta.findMany({
      where,
      include: { licenciado: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

router.post('/', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['licId', 'periodo', 'meta', 'realizado']);
    if (!data.licId || !data.periodo) return res.status(400).json({ error: 'licId e periodo são obrigatórios.' });
    data.meta = parseFloat(data.meta) || 0;
    data.realizado = parseFloat(data.realizado) || 0;
    res.status(201).json(await prisma.meta.create({ data }));
  } catch (err) { next(err); }
});

router.put('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['licId', 'periodo', 'meta', 'realizado']);
    if (data.meta !== undefined) data.meta = parseFloat(data.meta);
    if (data.realizado !== undefined) data.realizado = parseFloat(data.realizado);
    res.json(await prisma.meta.update({ where: { id: req.params.id }, data }));
  } catch (err) { next(err); }
});

module.exports = router;
