const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try {
    const where = req.user.role === 'LIC' ? { ativo: true } : {};
    res.json(await prisma.curso.findMany({
      where,
      include: {
        modulos: {
          include: { aulas: { orderBy: { ordem: 'asc' } } },
          orderBy: { ordem: 'asc' },
        },
      },
      orderBy: { ordem: 'asc' },
    }));
  } catch (err) { next(err); }
});

router.post('/', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['titulo', 'desc', 'thumb', 'ativo', 'ordem']);
    if (!data.titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
    res.status(201).json(await prisma.curso.create({ data }));
  } catch (err) { next(err); }
});

router.put('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['titulo', 'desc', 'thumb', 'ativo', 'ordem']);
    res.json(await prisma.curso.update({ where: { id: req.params.id }, data }));
  } catch (err) { next(err); }
});

router.delete('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    await prisma.curso.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Módulos
router.post('/:cursoId/modulos', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['titulo', 'ordem']);
    if (!data.titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
    res.status(201).json(await prisma.modulo.create({ data: { ...data, cursoId: req.params.cursoId } }));
  } catch (err) { next(err); }
});

// Aulas
router.post('/modulos/:moduloId/aulas', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['titulo', 'video', 'desc', 'pdf', 'ordem']);
    if (!data.titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
    res.status(201).json(await prisma.aula.create({ data: { ...data, moduloId: req.params.moduloId } }));
  } catch (err) { next(err); }
});

module.exports = router;
