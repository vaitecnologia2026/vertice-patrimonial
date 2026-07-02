const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const CFG_FIELDS = ['nomeEmpresa', 'corPrimaria', 'corSidebar', 'corBG', 'corCard', 'logo'];

router.get('/', auth, async (req, res, next) => {
  try {
    let cfg = await prisma.configuracao.findFirst();
    if (!cfg) cfg = await prisma.configuracao.create({ data: {} });
    res.json(cfg);
  } catch (err) { next(err); }
});

router.put('/', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, CFG_FIELDS);
    const cfg = await prisma.configuracao.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });
    res.json(cfg);
  } catch (err) { next(err); }
});

module.exports = router;
