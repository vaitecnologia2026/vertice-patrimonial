const logger = require('../utils/logger');

const notFound = (req, res, next) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
};

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack);

  // Prisma errors
  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'campo';
    return res.status(409).json({ error: `Registro duplicado: ${field} já existe.` });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Registro não encontrado.' });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message, details: err.details });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Erro interno do servidor.'
    : err.message || 'Erro interno do servidor.';

  res.status(status).json({ error: message });
};

module.exports = { notFound, errorHandler };
