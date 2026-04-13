const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { auth, adminOnly } = require('../middleware/auth');
const { pick } = require('../utils/sanitize');

const router = express.Router();

router.get('/', auth, adminOnly, async (req, res, next) => {
  try {
    res.json(await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, ativo: true, licId: true, createdAt: true },
      orderBy: { name: 'asc' },
    }));
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
    const VALID_ROLES = ['ADMIN', 'LIC'];
    if (data.role && !VALID_ROLES.includes(data.role)) {
      return res.status(400).json({ error: 'Perfil inválido. Valores: ' + VALID_ROLES.join(', ') });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Senha mínima 8 caracteres.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { ...data, password: hash },
      select: { id: true, name: true, email: true, role: true },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    res.json(await prisma.user.update({
      where: { id: req.params.id },
      data: { ativo: !!req.body.ativo },
      select: { id: true, name: true, email: true, role: true, ativo: true },
    }));
  } catch (err) { next(err); }
});

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

module.exports = router;
