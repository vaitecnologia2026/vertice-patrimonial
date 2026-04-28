require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { auth, blockRestricted } = require('./middleware/auth');

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
const contasRoutes      = require('./routes/contas');
const clubeRoutes       = require('./routes/clube');
const parceirosRoutes   = require('./routes/parceiros');
const lpRoutes          = require('./routes/lp');

const app = express();

// ─── SEGURANÇA ────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// CORS — suporta múltiplas origens separadas por vírgula
const rawCorsOrigin = process.env.CORS_ORIGIN;
let corsOrigin;
if (rawCorsOrigin) {
  const origins = rawCorsOrigin.split(',').map(o => o.trim()).filter(Boolean);
  corsOrigin = origins.length === 1 ? origins[0] : origins;
} else {
  corsOrigin = process.env.NODE_ENV === 'production' ? false : 'http://localhost:3000';
}
app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600, // cache preflight por 10 min
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

// Rate limiting para Landing Page pública (anti-spam de cadastro de parceiros)
const lpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos envios. Tente novamente em alguns minutos.' },
});

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.http(msg.trim()) } }));

// Uploads estáticos — com headers de segurança
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
// Rotas abertas (perfis Juridico/Pesquisa autenticados também chegam aqui):
app.use('/api/auth',         loginLimiter, authRoutes);

// Landing Page pública (parceiros do licenciado) — sem auth, com rate limit
app.use('/api/lp',           lpLimiter, lpRoutes);

// Operações → acesso liberado para ADMIN, LIC, JURIDICO, PESQUISA (controle fino por perfil nas próprias rotas)
app.use('/api/operacoes',    operacoesRoutes);

// Documentos/uploads → permitidos em Gestão de Equipe (Juridico e Pesquisa precisam anexar arquivos)
app.use('/api/documentos',   uploadLimiter, documentosRoutes);

// Rotas que Juridico/Pesquisa NÃO podem acessar (bloqueadas no backend):
app.use('/api/licenciados',  auth, blockRestricted, licenciadosRoutes);
app.use('/api/clientes',     auth, blockRestricted, clientesRoutes);
app.use('/api/vendas',       auth, blockRestricted, vendasRoutes);
app.use('/api/comissoes',    auth, blockRestricted, comissoesRoutes);
app.use('/api/contratos',    auth, blockRestricted, contratosRoutes);
app.use('/api/metas',        auth, blockRestricted, metasRoutes);
app.use('/api/consorcios',   auth, blockRestricted, consorciRoutes);
app.use('/api/cursos',       auth, blockRestricted, cursosRoutes);
app.use('/api/config',       auth, blockRestricted, configRoutes);
app.use('/api/auditoria',    auth, blockRestricted, auditoriaRoutes);
app.use('/api/usuarios',     auth, blockRestricted, usuariosRoutes);
app.use('/api/kanban',       auth, blockRestricted, kanbanRoutes);
app.use('/api/dashboard',    auth, blockRestricted, dashboardRoutes);
app.use('/api/contas',       auth, blockRestricted, contasRoutes);
app.use('/api/clube',        auth, blockRestricted, clubeRoutes);
app.use('/api/parceiros',    auth, blockRestricted, parceirosRoutes);

// ─── ERROR HANDLERS ──────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── FRONTEND SPA (catch-all para rotas não-API) ─────────────
const fs = require('fs');
const frontendPath = path.resolve(__dirname, '../../vertice-vai.html');

// Landing Page pública de Parceiros — antes do catch-all do SPA
const lpHtmlPath = path.resolve(__dirname, '../lp-parceiros.html');
if (fs.existsSync(lpHtmlPath)) {
  app.get('/lp/parceiros/:licId', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(lpHtmlPath);
  });
}

if (fs.existsSync(frontendPath)) {
  app.get(/^(?!\/api|\/uploads|\/health|\/lp\/).*$/, (req, res) => {
    res.sendFile(frontendPath);
  });
}

// ─── START (apenas quando rodando diretamente, não via Vercel) ─
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    logger.info(`Vertice API v3.1.0 rodando na porta ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
}

module.exports = app;
