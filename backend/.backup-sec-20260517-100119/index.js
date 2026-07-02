require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { version } = require('../package.json');
const prisma = require('./utils/prisma');
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
const consorciosRoutes  = require('./routes/consorcios');
const cursosRoutes      = require('./routes/cursos');
const configRoutes      = require('./routes/config');
const auditoriaRoutes   = require('./routes/auditoria');
const usuariosRoutes    = require('./routes/usuarios');
const kanbanRoutes      = require('./routes/kanban');
const dashboardRoutes   = require('./routes/dashboard');
const parceirosRoutes   = require('./routes/parceiros');
const partnerLeadsRoutes = require('./routes/partnerLeads');
const partnerPayoutsRoutes = require('./routes/partnerPayouts');
const lpRoutes          = require('./routes/lp');
const oportunidadesRoutes = require('./routes/oportunidades');

const app = express();

// ─── SEGURANÇA ────────────────────────────────────────────────
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// CORS — rejeitar wildcard em produção
const corsOrigin = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*');
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

// Rate limiting para uploads (aplicado só na rota POST de documentos)
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
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
  next();
}, express.static(path.join(__dirname, '../uploads')));

// Frontend estático — vertice-vai.html, lp-parceiros.html, lp-indicar.html
// Cache-Control forçado: HTML sempre fresco (no-store), assets cachable por 1h
const FRONTEND_DIR = path.join(__dirname, '..', 'public');
const noCacheHTML = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  next();
};
['vertice-vai.html', 'lp-parceiros.html', 'lp-indicar.html', 'lp-licenciados.html'].forEach(file => {
  app.get('/' + file, noCacheHTML, (req, res) => res.sendFile(path.join(FRONTEND_DIR, file)));
});
['lp-shared.css', 'logo-vertice.svg', 'logo-pegasus-gold.jpg'].forEach(file => {
  app.get('/' + file, (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(FRONTEND_DIR, file));
  });
});
app.get('/', (req, res) => res.redirect('/vertice-vai.html'));

// ─── HEALTH CHECK ────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let db = 'ok';
  try { await prisma.$queryRaw`SELECT 1`; } catch { db = 'error'; }
  res.status(db === 'ok' ? 200 : 503).json({
    status: db === 'ok' ? 'ok' : 'degraded',
    version,
    db,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// ─── ROTAS ───────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/licenciados',  licenciadosRoutes);
app.use('/api/clientes',     clientesRoutes);
app.use('/api/vendas',       vendasRoutes);
app.use('/api/comissoes',    comissoesRoutes);
app.use('/api/operacoes',    operacoesRoutes);
app.use('/api/contratos',    contratosRoutes);
app.use('/api/documentos',   uploadLimiter, documentosRoutes);
app.use('/api/metas',        metasRoutes);
app.use('/api/consorcios',   consorciosRoutes);
app.use('/api/cursos',       cursosRoutes);
app.use('/api/config',       configRoutes);
app.use('/api/auditoria',    auditoriaRoutes);
app.use('/api/usuarios',     usuariosRoutes);
app.use('/api/kanban',       kanbanRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/parceiros',         parceirosRoutes);
app.use('/api/partner-leads',     partnerLeadsRoutes);
app.use('/api/partner-payouts',   partnerPayoutsRoutes);
app.use('/api/lp',                lpRoutes);
app.use('/api/opportunities',     oportunidadesRoutes);
app.use('/api/oportunidades',     oportunidadesRoutes);

// Serve a LP pública (oportunidade.html) — tanto no path /oportunidade quanto /oportunidades/:slug
app.get(['/oportunidade.html', '/oportunidade'], noCacheHTML, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'oportunidade.html'));
});
app.get('/oportunidades/:slug', noCacheHTML, (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'oportunidade.html'));
});

// ─── ERROR HANDLERS ──────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── START ───────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`Vertice API v${version} rodando na porta ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
