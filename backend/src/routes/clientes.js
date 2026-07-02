const express = require('express');
const prisma = require('../utils/prisma');
const { auth } = require('../middleware/auth');
const { pick, formatCPF } = require('../utils/sanitize');

const router = express.Router();

const CLI_FIELDS = ['nome', 'cpf', 'tel', 'email', 'orig', 'end', 'status', 'prod', 'data', 'licId', 'parceiroId'];
const STATUS_CLI = ['ATIVO', 'INATIVO', 'FECHADO', 'PERDIDO'];

// GET /api/clientes
router.get('/', auth, async (req, res, next) => {
  try {
    const { q, status, licId, parceiroId } = req.query;
    const where = {};
    if (req.user.role === 'LIC') where.licId = req.user.licId;
    else if (licId) where.licId = licId;
    if (parceiroId) where.parceiroId = parceiroId;
    if (status) where.status = status.toUpperCase();
    if (q) where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { cpf: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
    ];

    const clientes = await prisma.cliente.findMany({
      where,
      include: {
        licenciado: { select: { id: true, nome: true } },
        parceiro:   { select: { id: true, nome: true } },
        _count: { select: { vendas: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clientes);
  } catch (err) { next(err); }
});

// Helper: valida que parceiroId pertence ao mesmo licId (previne IDOR cross-tenant)
async function assertParceiroOwnership(parceiroId, licId) {
  if (!parceiroId) return true;
  const p = await prisma.parceiro.findUnique({ where: { id: parceiroId }, select: { licId: true } });
  return !!p && p.licId === licId;
}

// GET /api/clientes/check-cpf/:cpf
// Scoped: LIC só verifica dentro da própria licença (previne enumeração cross-tenant — CWE-200)
router.get('/check-cpf/:cpf', auth, async (req, res, next) => {
  try {
    const cpf = formatCPF(req.params.cpf);
    if (!cpf) return res.json({ exists: false, cliente: null });

    const where = { cpf };
    if (req.user.role === 'LIC') where.licId = req.user.licId;

    const existing = await prisma.cliente.findFirst({
      where,
      include: { licenciado: { select: { nome: true } } },
    });
    res.json({ exists: !!existing, cliente: existing });
  } catch (err) { next(err); }
});

// POST /api/clientes
router.post('/', auth, async (req, res, next) => {
  try {
    const data = pick(req.body, CLI_FIELDS);
    data.licId = req.user.role === 'LIC' ? req.user.licId : data.licId;
    if (!data.licId) return res.status(400).json({ error: 'licId é obrigatório.' });
    if (!data.nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (data.status) {
      data.status = String(data.status).toUpperCase();
      if (!STATUS_CLI.includes(data.status)) return res.status(400).json({ error: 'Status de cliente inválido.' });
    }
    if (data.cpf) {
      const cpf = formatCPF(data.cpf);
      if (!cpf) return res.status(400).json({ error: 'CPF inválido.' });
      data.cpf = cpf;
    }
    // Valida parceiroId pertence ao mesmo licId — bloqueia LIC atribuir cliente a parceiro de outro tenant
    if (data.parceiroId && !await assertParceiroOwnership(data.parceiroId, data.licId)) {
      return res.status(403).json({ error: 'Parceiro não pertence a esta licença.' });
    }
    data.data = data.data ? new Date(data.data) : new Date();
    const cli = await prisma.cliente.create({ data });
    await prisma.auditoria.create({ data: { userId: req.user.id, action: 'CLIENTE_CRIADO', entity: 'Cliente', entityId: cli.id, desc: `Cliente cadastrado: ${cli.nome}`, ip: req.ip } }).catch(() => {});
    res.status(201).json(cli);
  } catch (err) { next(err); }
});

// PUT /api/clientes/:id
router.put('/:id', auth, async (req, res, next) => {
  try {
    // Verificar ownership para LIC
    const existing = await prisma.cliente.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Cliente não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const data = pick(req.body, CLI_FIELDS.filter(f => f !== 'licId'));
    if (data.status) {
      data.status = String(data.status).toUpperCase();
      if (!STATUS_CLI.includes(data.status)) return res.status(400).json({ error: 'Status de cliente inválido.' });
    }
    if (data.cpf) {
      const cpf = formatCPF(data.cpf);
      if (!cpf) return res.status(400).json({ error: 'CPF inválido.' });
      data.cpf = cpf;
    }
    // Mesma validação para update — não permite trocar pra parceiro de outra licença
    if (data.parceiroId && !await assertParceiroOwnership(data.parceiroId, existing.licId)) {
      return res.status(403).json({ error: 'Parceiro não pertence a esta licença.' });
    }
    if (data.data) data.data = new Date(data.data);
    const cli = await prisma.cliente.update({ where: { id: req.params.id }, data });
    await prisma.auditoria.create({ data: { userId: req.user.id, action: 'CLIENTE_EDITADO', entity: 'Cliente', entityId: cli.id, desc: `Cliente editado: ${cli.nome}`, ip: req.ip } }).catch(() => {});
    res.json(cli);
  } catch (err) { next(err); }
});

// DELETE /api/clientes/:id — bloqueia se o cliente tem vendas; limpa os cards do kanban.
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const existing = await prisma.cliente.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { vendas: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Cliente não encontrado.' });
    if (req.user.role === 'LIC' && existing.licId !== req.user.licId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    if (existing._count.vendas > 0) {
      return res.status(409).json({ error: 'Não é possível excluir um cliente com vendas. Cancele/remova as vendas primeiro.' });
    }
    await prisma.kanbanCard.deleteMany({ where: { cliId: existing.id } });
    await prisma.cliente.delete({ where: { id: existing.id } });
    await prisma.auditoria.create({ data: { userId: req.user.id, action: 'CLIENTE_EXCLUIDO', entity: 'Cliente', entityId: existing.id, desc: `Cliente excluído: ${existing.nome}`, ip: req.ip } }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
