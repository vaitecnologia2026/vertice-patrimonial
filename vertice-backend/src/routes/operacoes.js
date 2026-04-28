const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../utils/prisma');
const { auth, adminOnly, allowRoles } = require('../middleware/auth');
const { pick, isAllowedFile } = require('../utils/sanitize');

const router = express.Router();

const OP_FIELDS = [
  'tipo', 'cliId', 'licId', 'status',
  'end', 'bairro', 'cidade', 'tipo_imovel', 'modalidade', 'leilao', 'lance', 'aval', 'deb', 'ref', 'mes',
  'valImovel', 'valSolicit', 'prazo', 'taxa',
  'banco', 'contratoCodigo', 'dataContrato', 'motivo', 'economia',
  'grupo', 'cota', 'parcelas', 'parcelaPagas', 'valorMensal', 'assembleia', 'cl', 'msgs', 'resp',
];

// ─── Upload config — aceita PDF e Word para anexos de operações ──
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const OP_UPLOAD_SUBDIR = 'operacoes';

// Garante que o diretório existe
const opUploadPath = path.join(UPLOAD_DIR, OP_UPLOAD_SUBDIR);
if (!fs.existsSync(opUploadPath)) fs.mkdirSync(opUploadPath, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, opUploadPath),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `op-${req.params.id || 'new'}-${Date.now()}-${safe}`);
  },
});

const ANEXO_EXT = ['.pdf', '.doc', '.docx'];
const isAnexoPermitido = (filename) => {
  if (!filename) return false;
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return ANEXO_EXT.includes(ext);
};

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 25) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!isAnexoPermitido(file.originalname)) {
      return cb(new Error('Apenas arquivos PDF, DOC ou DOCX são permitidos.'), false);
    }
    cb(null, true);
  },
});

// ═══════════════════════════════════════════════════════════════
// OPERACOES — CRUD
// ═══════════════════════════════════════════════════════════════

// Acesso: ADMIN, LIC, JURIDICO, PESQUISA — cada perfil filtra conforme sua realidade
router.get('/', auth, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.tipo) where.tipo = req.query.tipo;
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (req.query.licId) where.licId = req.query.licId;
    if (req.query.status) where.status = req.query.status;

    const list = await prisma.operacao.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { anexos: { select: { id: true, nome: true, tipo: true, categoria: true } } },
    });
    res.json(list);
  } catch (err) { next(err); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const op = await prisma.operacao.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { anexos: { orderBy: { ordem: 'asc' } } },
    });
    if (req.user.role === 'LIC' && op.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    res.json(op);
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, OP_FIELDS);
    data.licId = req.user.role === 'LIC' ? req.user.licId : data.licId;
    if (data.leilao) data.leilao = new Date(data.leilao);
    if (data.dataContrato) data.dataContrato = new Date(data.dataContrato);
    if (data.assembleia) data.assembleia = new Date(data.assembleia);
    res.status(201).json(await prisma.operacao.create({ data }));
  } catch (err) { next(err); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    if (req.user.role === 'LIC') {
      const existing = await prisma.operacao.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.licId !== req.user.licId) {
        return res.status(403).json({ error: 'Acesso negado.' });
      }
    }
    const data = pick(req.body, OP_FIELDS.filter(f => f !== 'tipo'));
    if (data.leilao) data.leilao = new Date(data.leilao);
    if (data.dataContrato) data.dataContrato = new Date(data.dataContrato);
    if (data.assembleia) data.assembleia = new Date(data.assembleia);
    res.json(await prisma.operacao.update({ where: { id: req.params.id }, data }));
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, adminOnly, async (req, res, next) => {
  try {
    const op = await prisma.operacao.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    await prisma.auditoria.create({ data: { userId: req.user.id, action: 'OPERACAO_STATUS', entityId: op.id, desc: `Status → ${op.status}`, ip: req.ip } });
    res.json(op);
  } catch (err) { next(err); }
});

// PATCH /api/operacoes/:id/fluxo — atualiza estado do fluxo bifurcado da Arrematação
// Body: { etapa?: string, valor?: 'ok'|'andamento'|'pendente'|null, fluxo?: object, fluxoIndividual?: boolean }
router.patch('/:id/fluxo', auth, async (req, res, next) => {
  try {
    const op = await prisma.operacao.findUnique({ where: { id: req.params.id } });
    if (!op) return res.status(404).json({ error: 'Operação não encontrada.' });

    // LIC só edita o próprio
    if (req.user.role === 'LIC' && op.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const update = {};
    const desc = [];

    // Substituição completa do fluxo
    if (req.body.fluxo && typeof req.body.fluxo === 'object') {
      update.fluxo = req.body.fluxo;
      desc.push('fluxo completo atualizado');
    }
    // Patch parcial: { etapa: 'lanceRealizado', valor: 'ok' }
    if (req.body.etapa) {
      const fluxoAtual = (op.fluxo && typeof op.fluxo === 'object') ? op.fluxo : {};
      fluxoAtual[req.body.etapa] = req.body.valor;
      update.fluxo = fluxoAtual;
      desc.push(`${req.body.etapa} → ${req.body.valor}`);
    }
    // Toggle do "fluxo individual"
    if (typeof req.body.fluxoIndividual === 'boolean') {
      update.fluxoIndividual = req.body.fluxoIndividual;
      desc.push(`fluxoIndividual=${req.body.fluxoIndividual}`);
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'Nada a atualizar (envie fluxo, etapa+valor ou fluxoIndividual).' });
    }

    const updated = await prisma.operacao.update({ where: { id: op.id }, data: update });
    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'OPERACAO_FLUXO',
        entity: 'Operacao',
        entityId: op.id,
        desc: `Fluxo: ${desc.join('; ')}`,
        ip: req.ip,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// ANEXOS — Upload, listar, baixar, excluir
// Escopo: ADMIN + JURIDICO + PESQUISA (LIC não gerencia anexos internos)
// ═══════════════════════════════════════════════════════════════

const anexoAccess = allowRoles('ADMIN', 'JURIDICO', 'PESQUISA');

// POST /api/operacoes/:id/anexos — upload (aceita múltiplos arquivos)
router.post('/:id/anexos', auth, anexoAccess, upload.array('arquivos', 10), async (req, res, next) => {
  try {
    const op = await prisma.operacao.findUnique({ where: { id: req.params.id } });
    if (!op) return res.status(404).json({ error: 'Operação não encontrada.' });

    const categoria = (req.body.categoria || 'outro').toLowerCase();
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const created = await Promise.all(files.map((file, i) => prisma.anexo.create({
      data: {
        opId: op.id,
        nome: file.originalname,
        tipo: path.extname(file.originalname).slice(1).toLowerCase(),
        tam: file.size,
        url: `/uploads/${OP_UPLOAD_SUBDIR}/${file.filename}`,
        categoria,
        uploadBy: req.user.id,
        ordem: i,
      },
    })));

    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'ANEXO_UPLOAD',
        entity: 'Operacao',
        entityId: op.id,
        desc: `${created.length} arquivo(s) anexado(s) [${categoria}]`,
        ip: req.ip,
      },
    });

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /api/operacoes/:id/anexos — listar anexos da operação
router.get('/:id/anexos', auth, anexoAccess, async (req, res, next) => {
  try {
    const list = await prisma.anexo.findMany({
      where: { opId: req.params.id },
      orderBy: [{ categoria: 'asc' }, { ordem: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(list);
  } catch (err) { next(err); }
});

// DELETE /api/operacoes/:id/anexos/:anexoId — remover anexo
router.delete('/:id/anexos/:anexoId', auth, anexoAccess, async (req, res, next) => {
  try {
    const anexo = await prisma.anexo.findUnique({ where: { id: req.params.anexoId } });
    if (!anexo || anexo.opId !== req.params.id) {
      return res.status(404).json({ error: 'Anexo não encontrado.' });
    }

    // Remove do disco (melhor esforço — não falha se arquivo já não existe)
    const filePath = path.join(UPLOAD_DIR, anexo.url.replace('/uploads/', ''));
    fs.unlink(filePath, () => {});

    await prisma.anexo.delete({ where: { id: anexo.id } });
    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'ANEXO_DELETE',
        entity: 'Operacao',
        entityId: req.params.id,
        desc: `Anexo removido: ${anexo.nome}`,
        ip: req.ip,
      },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/operacoes/:id/anexos/ordem — reordena (usado pelo recurso "combinar")
router.patch('/:id/anexos/ordem', auth, anexoAccess, async (req, res, next) => {
  try {
    const { ordem } = req.body; // [{id, ordem}, ...]
    if (!Array.isArray(ordem)) return res.status(400).json({ error: 'Formato inválido.' });

    await Promise.all(ordem.map(({ id, ordem: ord }) =>
      prisma.anexo.updateMany({
        where: { id, opId: req.params.id },
        data: { ordem: ord },
      })
    ));

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/operacoes/:id/anexos/combinar — marca um conjunto como "combinado"
// (a combinação física dos PDFs pode ser feita em worker; aqui é marcação lógica)
router.post('/:id/anexos/combinar', auth, anexoAccess, async (req, res, next) => {
  try {
    const { anexoIds } = req.body; // ids a combinar
    if (!Array.isArray(anexoIds) || !anexoIds.length) {
      return res.status(400).json({ error: 'Selecione ao menos um anexo.' });
    }

    await prisma.anexo.updateMany({
      where: { id: { in: anexoIds }, opId: req.params.id },
      data: { categoria: 'combinado' },
    });

    await prisma.auditoria.create({
      data: {
        userId: req.user.id,
        action: 'ANEXO_COMBINAR',
        entity: 'Operacao',
        entityId: req.params.id,
        desc: `${anexoIds.length} anexo(s) marcado(s) como combinado`,
        ip: req.ip,
      },
    });

    res.json({ ok: true, atualizados: anexoIds.length });
  } catch (err) { next(err); }
});

module.exports = router;
