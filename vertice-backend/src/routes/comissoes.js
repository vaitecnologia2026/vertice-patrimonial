const express = require('express');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/comissoes
router.get('/', auth, async (req, res, next) => {
  try {
    const where = req.user.role === 'LIC' ? { licId: req.user.licId } : {};
    if (req.query.status) {
      const validStatus = ['PENDENTE', 'PAGO', 'CANCELADO'];
      const s = req.query.status.toUpperCase();
      if (validStatus.includes(s)) where.status = s;
    }
    const list = await prisma.comissao.findMany({
      where,
      include: {
        venda: { select: { id: true, cliente: { select: { nome: true } } } },
        licenciado: { select: { nome: true } },
      },
      orderBy: { data: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

// PATCH /api/comissoes/:id/pagar
router.patch('/:id/pagar', auth, adminOnly, async (req, res, next) => {
  try {
    const com = await prisma.comissao.update({
      where: { id: req.params.id },
      data: { status: 'PAGO' },
    });
    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'COMISSAO_PAGA', entityId: com.id, desc: `Comissão ${com.id} marcada como paga`, ip: req.ip },
    });
    res.json(com);
  } catch (err) { next(err); }
});

module.exports = router;
