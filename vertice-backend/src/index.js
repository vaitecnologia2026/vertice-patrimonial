require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Routes
const authRoutes        = require('./routes/auth');
const licenciadosRoutes = require('./routes/licenciados');
const clientesRoutes    = require('./routes/clientes');
const vendasRoutes      = require('./routes/vendas');
const comissoesRoutes   = require('./routes/comissoes');
const operacoesRoutes   = require('./routes/operacoes');
const contratosRoutes   = require('./routes/contratos');
const documentosRoutes  = require('./routes/documentos');
const metasRoutes       = require('./routes/metas');
const consorciRoutes    = require('./routes/consorcios');
const cursosRoutes      = require('./routes/cursos');
const configRoutes      = require('./routes/config');
const auditoriaRoutes   = require('./routes/auditoria');
const usuariosRoutes    = require('./routes/usuarios');
const kanbanRoutes      = require('./routes/kanban');
const dashboardRoutes   = require('./routes/dashboard');

const app = express();

// ─── SEGURANÇA ────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// CORS — suporta múltiplas origens separadas por vírgula ou wildcard em dev
const rawCorsOrigin = process.env.CORS_ORIGIN;
let corsOrigin;
if (rawCorsOrigin) {
  const origins = rawCorsOrigin.split(',').map(o => o.trim());
  corsOrigin = origins.length === 1 ? origins[0] : origins;
} else {
  corsOrigin = process.env.NODE_ENV === 'production' ? false : '*';
}
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600,
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
}));

// Rate limiting específico para login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});

// Rate limiting para uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Muitos uploads. Aguarde antes de enviar mais arquivos.' },
});

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.http(msg.trim()) } }));

// Uploads estáticos — com headers de segurança
// UPLOAD_DIR pode ser sobrescrito via env (ex: /tmp para Vercel)
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
  next();
}, express.static(uploadDir));

// ─── HEALTH CHECK ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ─── ROTAS ───────────────────────────────────────────────────
app.use('/api/auth',         loginLimiter, authRoutes);
app.use('/api/licenciados',  licenciadosRoutes);
app.use('/api/clientes',     clientesRoutes);
app.use('/api/vendas',       vendasRoutes);
app.use('/api/comissoes',    comissoesRoutes);
app.use('/api/operacoes',    operacoesRoutes);
app.use('/api/contratos',    contratosRoutes);
app.use('/api/documentos',   uploadLimiter, documentosRoutes);
app.use('/api/metas',        metasRoutes);
app.use('/api/consorcios',   consorciRoutes);
app.use('/api/cursos',       cursosRoutes);
app.use('/api/config',       configRoutes);
app.use('/api/auditoria',    auditoriaRoutes);
app.use('/api/usuarios',     usuariosRoutes);
app.use('/api/kanban',       kanbanRoutes);
app.use('/api/dashboard',    dashboardRoutes);

// ─── FRONTEND SPA (catch-all para rotas não-API) ─────────────
// Serve o HTML principal para qualquer rota que não seja /api, /uploads ou /health
const frontendPath = path.resolve(__dirname, '../../vertice-vai.html');
if (fs.existsSync(frontendPath)) {
  app.get(/^(?!\/api|\/uploads|\/health).*$/, (req, res) => {
    res.sendFile(frontendPath);
  });
}

// ─── ERROR HANDLERS ──────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── START (apenas quando rodando diretamente, não via Vercel) ─
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    logger.info(`Vertice API v3.1.0 rodando na porta ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
}

module.exports = app;
