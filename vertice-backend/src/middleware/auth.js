const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true, ativo: true, licId: true },
    });

    if (!user || !user.ativo) {
      return res.status(401).json({ error: 'Usuário inativo ou não encontrado.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado.', expired: true });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
  next();
};

const licOnly = (req, res, next) => {
  if (req.user?.role === 'LIC') {
    req.licFilter = req.user.licId;
  }
  next();
};

// ─── PERFIS RESTRITOS ─────────────────────────────────────────
// Jurídico e Pesquisa → só podem acessar Gestão de Equipe + Oportunidades.
// Bloqueia qualquer rota fora do escopo permitido.
const RESTRICTED_ROLES = ['JURIDICO', 'PESQUISA'];

const blockRestricted = (req, res, next) => {
  if (RESTRICTED_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Este perfil não tem permissão para acessar este módulo.' });
  }
  next();
};

// allowRoles('ADMIN', 'JURIDICO', 'PESQUISA') → qualquer rota aceita lista
const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Permissão insuficiente para este módulo.' });
  }
  next();
};

// Perfis internos de operação (Jurídico, Pesquisa e Admin) — usados em Gestão de Equipe e Oportunidades.
const gestaoEquipeAccess = allowRoles('ADMIN', 'JURIDICO', 'PESQUISA');

module.exports = {
  auth,
  adminOnly,
  licOnly,
  blockRestricted,
  allowRoles,
  gestaoEquipeAccess,
  RESTRICTED_ROLES,
};
