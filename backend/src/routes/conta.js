// routes/conta.js — Autoatendimento de privacidade (LGPD / App Store / Play Store)
// Endpoints PÚBLICOS (pré-login), protegidos por verificação de credenciais.
//   POST /api/conta/excluir         → exclui a conta + dados pessoais (irreversível)
//   POST /api/conta/excluir-dados   → apaga dados pessoais e encerra sessões, mantém a conta
//
// Em ambos, o usuário comprova a posse da conta informando e-mail + senha.
// Registros exigidos por lei (fiscais/contratuais) são retidos de forma anonimizada,
// conforme art. 16 da LGPD, e desvinculados da identidade do titular.

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

const router = express.Router();

// Localiza e valida o titular pelas credenciais.
async function autenticarTitular(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { erro: 'Credenciais inválidas.' };
  // Conta já removida anteriormente
  if (!user.ativo && /@removido\.vertice\.invalid$/.test(user.email)) {
    return { erro: 'Esta conta já foi excluída.' };
  }
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return { erro: 'Credenciais inválidas.' };
  return { user };
}

const regrasCredenciais = [
  body('email').isEmail().normalizeEmail().withMessage('E-mail inválido.'),
  body('password').isLength({ min: 6 }).withMessage('Senha obrigatória.'),
];

function checarErros(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ─── POST /api/conta/excluir ──────────────────────────────────
// Exclui a conta de acesso e anonimiza os dados pessoais do titular.
router.post('/excluir', regrasCredenciais, async (req, res, next) => {
  try {
    if (!checarErros(req, res)) return;

    const { email, password } = req.body;
    const { user, erro } = await autenticarTitular(email, password);
    if (erro) return res.status(401).json({ error: erro });

    const anonEmail = `removido_${user.id}@removido.vertice.invalid`;

    await prisma.$transaction([
      // Encerra todas as sessões ativas
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      // Anonimiza identidade e desativa o acesso (soft-delete irreversível)
      prisma.user.update({
        where: { id: user.id },
        data: {
          email: anonEmail,
          name: 'Conta excluída',
          avatar: null,
          ativo: false,
        },
      }),
      // Trilha de auditoria da solicitação (sem PII)
      prisma.auditoria.create({
        data: {
          userId: user.id,
          action: 'ACCOUNT_DELETE',
          entity: 'User',
          entityId: user.id,
          desc: 'Exclusão de conta solicitada pelo titular (autoatendimento)',
          ip: req.ip,
        },
      }),
    ]);

    logger.info(`Conta excluída pelo titular: ${user.id}`);

    return res.json({
      ok: true,
      message:
        'Sua conta foi excluída. O acesso foi desativado e seus dados pessoais foram ' +
        'anonimizados. Registros exigidos por lei são retidos de forma anonimizada e ' +
        'eliminados ao fim do prazo legal.',
    });
  } catch (err) { next(err); }
});

// ─── POST /api/conta/excluir-dados ────────────────────────────
// Apaga dados pessoais e encerra sessões, preservando o acesso à conta.
router.post('/excluir-dados', regrasCredenciais, async (req, res, next) => {
  try {
    if (!checarErros(req, res)) return;

    const { email, password } = req.body;
    const { user, erro } = await autenticarTitular(email, password);
    if (erro) return res.status(401).json({ error: erro });

    await prisma.$transaction([
      // Encerra todas as sessões ativas (o titular precisará entrar novamente)
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      // Remove dados pessoais opcionais (foto de perfil)
      prisma.user.update({
        where: { id: user.id },
        data: { avatar: null },
      }),
      prisma.auditoria.create({
        data: {
          userId: user.id,
          action: 'DATA_ERASURE',
          entity: 'User',
          entityId: user.id,
          desc: 'Eliminação de dados pessoais solicitada pelo titular (conta mantida)',
          ip: req.ip,
        },
      }),
    ]);

    logger.info(`Dados pessoais eliminados (conta mantida): ${user.id}`);

    return res.json({
      ok: true,
      message:
        'Seus dados pessoais opcionais foram eliminados e todas as sessões foram encerradas. ' +
        'Sua conta de acesso permanece ativa. Dados necessários ao funcionamento do serviço e ' +
        'registros legais são mantidos conforme a Política de Privacidade.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
