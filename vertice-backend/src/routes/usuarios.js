const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

router.get('/', auth, adminOnly, async (req, res, next) => {
  try {
    res.json(await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, ativo: true, licId: true, createdAt: true, updatedAt: true },
      orderBy: { name: 'asc' },
    }));
  } catch (err) { next(err); }
});

router.get('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, role: true, ativo: true, licId: true, createdAt: true, updatedAt: true },
    });
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['name', 'email', 'role', 'licId']);
    const { password } = req.body;
    if (!data.email || !data.name || !password) {
      return res.status(400).json({ error: 'name, email e password são obrigatórios.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }
    const VALID_ROLES = ['ADMIN', 'LIC', 'JURIDICO', 'PESQUISA'];
    if (data.role && !VALID_ROLES.includes(data.role)) {
      return res.status(400).json({ error: 'Perfil inválido. Valores: ' + VALID_ROLES.join(', ') });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Senha mínima 8 caracteres.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { ...data, password: hash },
      select: { id: true, name: true, email: true, role: true, ativo: true, licId: true },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
});

// IMPORTANT: /me/senha BEFORE /:id routes to avoid Express matching "me" as :id
router.patch('/me/senha', auth, async (req, res, next) => {
  try {
    const { senhaAtual, novaSenha } = req.body;
    if (!senhaAtual || !novaSenha) return res.status(400).json({ error: 'Campos obrigatórios.' });
    if (novaSenha.length < 8) return res.status(400).json({ error: 'Nova senha mínima 8 caracteres.' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!await bcrypt.compare(senhaAtual, user.password)) {
      return res.status(400).json({ error: 'Senha atual incorreta.' });
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { password: await bcrypt.hash(novaSenha, 12) } });
    res.json({ message: 'Senha alterada com sucesso.' });
  } catch (err) { next(err); }
});

// PUT /api/usuarios/:id — editar dados do usuário (admin)
router.put('/:id', auth, adminOnly, async (req, res, next) => {
  try {
    const data = pick(req.body, ['name', 'email', 'role', 'licId', 'ativo']);
    const { password } = req.body;

    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }
    const VALID_ROLES = ['ADMIN', 'LIC', 'JURIDICO', 'PESQUISA'];
    if (data.role && !VALID_ROLES.includes(data.role)) {
      return res.status(400).json({ error: 'Perfil inválido. Valores: ' + VALID_ROLES.join(', ') });
    }

    // Permitir trocar a senha se enviada
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Senha mínima 8 caracteres.' });
      data.password = await bcrypt.hash(password, 12);
    }

    // Não permitir admin desativar a si mesmo
    if (req.params.id === req.user.id && data.ativo === false) {
      return res.status(400).json({ error: 'Você não pode desativar a si mesmo.' });
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, ativo: true, licId: true },
    });

    await prisma.auditoria.create({
      data: { userId: req.user.id, action: 'USER_UPDATE', entityId: user.id, desc: `Usuário ${user.name} atualizado`, ip: req.ip },
    });

    res.json(user);
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id && !req.body.ativo) {
      return res.status(400).json({ error: 'Você não pode desativar a si mesmo.' });
    }
    res.json(await prisma.user.update({
      where: { id: req.params.id },
      data: { ativo: !!req.body.ativo },
      select: { id: true, name: true, email: true, role: true, ativo: true },
    }));
  } catch (err) { next(err); }
});

module.exports = router;
