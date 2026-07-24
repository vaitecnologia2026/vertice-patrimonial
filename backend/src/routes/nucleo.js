const express = require('express');
const prisma = require('../utils/prisma');
const { auth } = require('../middleware/auth');

// Núcleo do CRM migrado do localStorage → Postgres.
// Cada coleção é "espelho": o objeto completo vai em `data` (Json); GET devolve a
// lista de objetos; PUT atualiza a coleção. Single-tenant: coleção global da operação.
//
// ANTI-PERDA DE DADOS (campos críticos): um PUT vindo de uma sessão DEFASADA (aba antiga,
// outro device que carregou antes de um upload) costumava SUBSTITUIR o objeto inteiro e
// apagar o dossiê/estudo/fotos que outra sessão tinha acabado de salvar ("atualizou e
// sumiu de novo"). Agora cada item é MESCLADO com o que já está no banco:
//   - vence por _ts (mais novo) para os campos comuns;
//   - campos críticos NUNCA são zerados: se o vencedor está vazio e o outro tem valor,
//     mantém o valor (permite substituir por algo novo, bloqueia apagar por engano);
//   - histórico (msgs) nunca encolhe (append-only).
const tsOf = (o) => (o && typeof o._ts === 'number' ? o._ts : 0);
const isEmpty = (v) =>
  v == null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

// Campos protegidos contra apagamento acidental (substituíveis por valor não-vazio).
const COALESCE = ['dossie', 'dossieNome', 'estudo', 'parecer', 'parecerBy', 'cl', 'opp_fotos', 'anexos', 'comparativos'];
// Campos append-only que nunca devem encolher.
const LONGER = ['msgs'];

function mergeItem(incoming, prev) {
  if (!prev || typeof prev !== 'object') return incoming;
  const newer = tsOf(incoming) >= tsOf(prev) ? incoming : prev;
  const older = newer === incoming ? prev : incoming;
  const out = { ...newer };
  for (const f of COALESCE) {
    if (isEmpty(out[f]) && !isEmpty(older[f])) out[f] = older[f];
  }
  for (const f of LONGER) {
    const a = Array.isArray(out[f]) ? out[f] : [];
    const b = Array.isArray(older[f]) ? older[f] : [];
    if (b.length > a.length) out[f] = b;
  }
  return out;
}

function collectionRouter(model, indexFields) {
  const router = express.Router();
  router.use(auth);

  router.get('/', async (req, res, next) => {
    try {
      const rows = await prisma[model].findMany({ orderBy: { updatedAt: 'desc' } });
      res.json(rows.map((r) => r.data));
    } catch (e) { next(e); }
  });

  router.put('/', async (req, res, next) => {
    try {
      const items = Array.isArray(req.body && req.body.items)
        ? req.body.items
        : (Array.isArray(req.body) ? req.body : null);
      if (!items) return res.status(400).json({ error: 'items deve ser uma lista.' });

      const valid = items.filter((it) => it && it.id != null);

      // Proteção contra perda de dados: um PUT vazio (cliente com localStorage zerado,
      // payload corrompido, etc.) NÃO pode zerar uma coleção que já tem registros.
      if (valid.length === 0) {
        const existing = await prisma[model].count();
        if (existing > 0) {
          return res.status(409).json({ error: 'Recusado: lista vazia não pode substituir uma coleção com dados.' });
        }
      }

      // Mescla cada item com a versão atual do banco (anti-clobber de campos críticos).
      const existingRows = await prisma[model].findMany();
      const prevById = new Map(existingRows.map((r) => [String(r.id), r.data]));

      const rows = valid.map((it) => {
        const data = mergeItem(it, prevById.get(String(it.id)));
        const base = { id: String(it.id), data };
        for (const f of indexFields) {
          base[f] = data[f] != null ? String(data[f]).slice(0, 160) : null;
        }
        return base;
      });

      await prisma.$transaction([
        prisma[model].deleteMany({}),
        ...(rows.length ? [prisma[model].createMany({ data: rows, skipDuplicates: true })] : []),
      ]);
      res.json({ ok: true, count: rows.length });
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = {
  imoveis: collectionRouter('imovel', ['status', 'cidade', 'resp']),
  colaboradores: collectionRouter('colaborador', ['nome']),
  corretores: collectionRouter('corretor', ['nome']),
};
// exporta o merge p/ teste offline
module.exports._mergeItem = mergeItem;
