// Endpoints PÚBLICOS (sem auth) usados pela Landing Page de Parceiros do Licenciado.
// O rate limit é aplicado em /api/index.js antes de chegar aqui.
const express = require('express');
const prisma = require('../utils/prisma');
const { formatCPF, formatCNPJ } = require('../utils/sanitize');

const router = express.Router();

const VALID_TIPO_COM = ['FIXO', 'PERCENTUAL'];

// Lista pública dos produtos Vértice (estática — não vaza dados sensíveis)
const PRODUTOS_PUBLICOS = [
  { id: 'arremata',    nome: 'Arrematação Individual', desc: 'Compra de imóveis em leilão judicial e extrajudicial com gestão completa.' },
  { id: 'homeequity',  nome: 'Home Equity',            desc: 'Crédito com garantia de imóvel — taxas competitivas e liberação rápida.' },
  { id: 'revisao',     nome: 'Revisão Contratual',     desc: 'Análise jurídica de contratos bancários para redução de encargos abusivos.' },
  { id: 'clube',       nome: 'Clube do Milhão',        desc: 'Consórcio dedicado à arrematação de imóveis em grupos exclusivos.' },
];

function normalizeDocumento(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11) return formatCPF(digits);
  if (digits.length === 14) return formatCNPJ(digits);
  return null;
}

// GET /api/lp/parceiros/:licId
// Retorna dados públicos do Licenciado dono da LP + lista de produtos.
router.get('/parceiros/:licId', async (req, res, next) => {
  try {
    const lic = await prisma.licenciado.findUnique({
      where: { id: req.params.licId },
      select: { id: true, nome: true, empresa: true, estado: true, status: true },
    });
    if (!lic) return res.status(404).json({ error: 'Licenciado não encontrado.' });
    if (lic.status === 'INATIVO') return res.status(403).json({ error: 'Licenciado inativo.' });

    res.json({
      licenciado: { id: lic.id, nome: lic.nome, empresa: lic.empresa, estado: lic.estado },
      produtos: PRODUTOS_PUBLICOS,
    });
  } catch (err) { next(err); }
});

// POST /api/lp/parceiros/:licId
// Cadastro público de Parceiro vinculado ao Licenciado dono da LP.
router.post('/parceiros/:licId', async (req, res, next) => {
  try {
    const lic = await prisma.licenciado.findUnique({
      where: { id: req.params.licId },
      select: { id: true, status: true, nome: true },
    });
    if (!lic) return res.status(404).json({ error: 'Licenciado não encontrado.' });
    if (lic.status === 'INATIVO') return res.status(403).json({ error: 'Cadastros indisponíveis no momento.' });

    const b = req.body || {};
    const nome = String(b.nome || '').trim();
    const whatsapp = String(b.whatsapp || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const documento = normalizeDocumento(b.documento);
    const cidade = b.cidade ? String(b.cidade).trim() : null;
    const estado = b.estado ? String(b.estado).trim().toUpperCase().slice(0, 2) : null;
    const tipoAtuacao = b.tipoAtuacao ? String(b.tipoAtuacao).trim().slice(0, 80) : null;
    const prodInteresse = b.prodInteresse ? String(b.prodInteresse).trim().slice(0, 80) : null;
    const observacao = b.observacao ? String(b.observacao).trim().slice(0, 1000) : null;

    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!whatsapp) return res.status(400).json({ error: 'WhatsApp é obrigatório.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
    if (!documento) return res.status(400).json({ error: 'CPF ou CNPJ inválido.' });

    // Anti-duplicação simples: mesmo documento + mesmo licId nos últimos 24h
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dup = await prisma.parceiro.findFirst({
      where: { licId: lic.id, documento, createdAt: { gte: desde } },
    });
    if (dup) return res.status(409).json({ error: 'Cadastro já efetuado recentemente. Aguarde contato do licenciado.' });

    const parc = await prisma.parceiro.create({
      data: {
        licId: lic.id,
        nome, whatsapp, email, documento,
        cidade, estado, tipoAtuacao, prodInteresse, observacao,
        origem: 'lp',
        ipCadastro: req.ip,
        // tipoComissao e valComissao ficam no padrão do schema (PERCENTUAL, 0)
        // — o licenciado define depois pelo CRM.
      },
      select: { id: true, nome: true, createdAt: true },
    });

    res.status(201).json({
      ok: true,
      mensagem: `Cadastro recebido com sucesso! O licenciado ${lic.nome} entrará em contato em breve.`,
      parceiro: parc,
    });
  } catch (err) { next(err); }
});

module.exports = router;
