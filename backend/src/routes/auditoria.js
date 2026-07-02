const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, adminOnly, async (req, res, next) => {
  try {
    const { q, action, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const where = {};
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (q) where.desc = { contains: q, mode: 'insensitive' };
    const [list, total] = await Promise.all([
      prisma.auditoria.findMany({
        where,
        include: { user: { select: { name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: (pageNum - 1) * limitNum,
      }),
      prisma.auditoria.count({ where }),
    ]);
    res.json({ list, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
  } catch (err) { next(err); }
});

module.exports = router;
