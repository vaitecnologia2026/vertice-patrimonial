const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

const LIC_FIELDS = ['nome', 'empresa', 'cnpj', 'estado', 'email', 'tel', 'pix', 'banco', 'status', 'meta', 'inicio', 'ano', 'taxa', 'comHE', 'motivo'];

// GET /api/licenciados
router.get('/', auth, async (req, res, next) => {
  try {
    const { status, estado, q } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (estado) where.estado = estado;
    if (q) where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { empresa: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];

    if (req.user.role === 'LIC') where.id = req.user.licId;

    const licenciados = await prisma.licenciado.findMany({
      where,
      include: {
        _count: { select: { clientes: true, vendas: true } },
        metas: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { nome: 'asc' },
    });

    // COLAB só precisa de id/nome para o dropdown do cadastro de cliente —
    // não expor CNPJ/PIX/banco/contato da rede a quem não é admin.
    const result = req.user.role === 'COLAB'
      ? licenciados.map((l) => ({ id: l.id, nome: l.nome, empresa: l.empresa, estado: l.estado, status: l.status }))
      : licenciados;
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/licenciados/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    if (req.user.role === 'COLAB') {
      return res.status(403).json({ error: 'Acesso restrito.' });
    }
    if (req.user.role === 'LIC' && req.user.licId !== req.params.id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const lic = await prisma.licenciado.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(lic);
  } catch (err) { next(err); }
});

// POST /api/licenciados
router.post('/', auth, adminOnly, [
  body('nome').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('cnpj').notEmpty().trim(),
  body('estado').isLength({ min: 2, max: 2 }),
  body('senha').isLength({ min: 8 }).withMessage('Senha mínima 8 caracteres.'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { senha } = req.body;
    const data = pick(req.body, LIC_FIELDS);
    const hash = await bcrypt.hash(senha, 12); // hash fora da transação (trabalho de CPU)

    // Licenciado + login (User) na MESMA transação — nunca deixa licenciado sem acesso.
    const lic = await prisma.$transaction(async (tx) => {
      const l = await tx.licenciado.create({
        data: { ...data, inicio: data.inicio ? new Date(data.inicio) : new Date() },
      });
      await tx.user.create({
        data: { email: data.email, password: hash, name: data.nome, role: 'LIC', licId: l.id },
      });
      return l;
    });

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'LICENCIADO_CRIADO', entityId: lic.id, desc: `Licenciado ${lic.nome} criado`, ip: req.ip },
    });

    res.status(201).json(lic);
  } catch (err) { next(err); }
});

// PUT /api/licenciados/:id
router.put('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const { senha } = req.body;
    const data = pick(req.body, LIC_FIELDS);

    const lic = await prisma.licenciado.update({
      where: { id: req.params.id },
      data: { ...data, ...(data.inicio && { inicio: new Date(data.inicio) }) },
    });

    // Mantém o login em sincronia: se o e-mail do licenciado mudou, atualiza o User vinculado
    // (o login usa User.email — sem isso, o e-mail exibido e o de acesso divergem).
    if (data.email) {
      await prisma.user.updateMany({ where: { licId: lic.id }, data: { email: data.email } });
    }

    if (senha && senha.length >= 8) {
      const hash = await bcrypt.hash(senha, 12);
      await prisma.user.updateMany({ where: { licId: lic.id }, data: { password: hash } });
    }

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'LICENCIADO_ATUALIZADO', entityId: lic.id, desc: `Licenciado ${lic.nome} atualizado`, ip: req.ip },
    });

    res.json(lic);
  } catch (err) { next(err); }
});

// PATCH /api/licenciados/:id/status
router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatus = ['PENDENTE', 'ATIVO', 'SUSPENSO', 'INATIVO', 'REPROVADO'];
    if (!validStatus.includes(status?.toUpperCase())) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const lic = await prisma.licenciado.update({
      where: { id: req.params.id },
      data: { status: status.toUpperCase() },
    });
    res.json(lic);
  } catch (err) { next(err); }
});

// PATCH /api/licenciados/:id/aprovar — aprova PENDENTE, cria User
router.patch('/:id/aprovar', auth, adminOnly, async (req, res, next) => {
  try {
    const { senha, taxa, meta, comHE } = req.body;
    if (!senha || senha.length < 8) {
      return res.status(400).json({ error: 'Senha mínima 8 caracteres.' });
    }

    const lic = await prisma.licenciado.findUnique({ where: { id: req.params.id } });
    if (!lic) return res.status(404).json({ error: 'Licenciado não encontrado.' });

    const updated = await prisma.licenciado.update({
      where: { id: lic.id },
      data: {
        status: 'ATIVO',
        approvedAt: new Date(),
        taxa: taxa || lic.taxa,
        meta: meta != null ? parseFloat(meta) : lic.meta,
        comHE: comHE != null ? parseFloat(comHE) : lic.comHE,
        inicio: lic.inicio || new Date(),
      },
    });

    // Criar User vinculado se ainda não existir
    const existingUser = await prisma.user.findUnique({ where: { email: lic.email } });
    if (!existingUser) {
      const hash = await bcrypt.hash(senha, 12);
      await prisma.user.create({
        data: { email: lic.email, password: hash, name: lic.nome, role: 'LIC', licId: lic.id },
      });
    } else if (req.body.resetPassword) {
      const hash = await bcrypt.hash(senha, 12);
      await prisma.user.update({ where: { id: existingUser.id }, data: { password: hash, ativo: true } });
    }

    await prisma.auditoria.create({
      data: {
        userId: req.user.id, action: 'LICENCIADO_APROVADO', entity: 'Licenciado', entityId: updated.id,
        desc: `Licenciado ${updated.nome} (${updated.empresa}) aprovado · taxa ${updated.taxa} · meta ${updated.meta}`,
        ip: req.ip,
      },
    });

    res.json({ licenciado: updated, credenciaisCriadas: !existingUser });
  } catch (err) { next(err); }
});

// PATCH /api/licenciados/:id/reprovar
router.patch('/:id/reprovar', auth, adminOnly, async (req, res, next) => {
  try {
    const motivo = req.body.motivo ? String(req.body.motivo).slice(0, 500) : null;
    const lic = await prisma.licenciado.update({
      where: { id: req.params.id },
      data: { status: 'REPROVADO', rejectMotivo: motivo },
    });
    await prisma.auditoria.create({
      data: {
        userId: req.user.id, action: 'LICENCIADO_REPROVADO', entity: 'Licenciado', entityId: lic.id,
        desc: `Licenciado ${lic.nome} reprovado${motivo ? ' · ' + motivo : ''}`,
        ip: req.ip,
      },
    });
    res.json(lic);
  } catch (err) { next(err); }
});

module.exports = router;
