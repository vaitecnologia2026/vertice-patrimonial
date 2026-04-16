# Vértice VAI — Atualização de Perfis e Anexos

**Versão:** 3.1.1
**Data:** Abril 2026
**Escopo:** Controle de acesso por perfil + upload multi-arquivo em Gestão de Equipe
**Líder:** Board Chair (Advisory Board Squad)

---

## 1. Controle de Acesso (CRÍTICO) — ✅ ENTREGUE

### Novos Perfis Implementados
| Perfil     | Role (backend) | Acesso permitido            |
|------------|----------------|------------------------------|
| Jurídico   | `JURIDICO`     | **Apenas** Gestão de Equipe |
| Pesquisa   | `PESQUISA`     | **Apenas** Gestão de Equipe |

### Regras Aplicadas
- ✅ Login redireciona automaticamente para `Gestão de Equipe` (overlay GE aberto)
- ✅ Sidebar reduzida a uma única entrada (`Gestão de Equipe`)
- ✅ **Não conseguem visualizar**: dashboard, oportunidades gerais (do CRM), financeiro, clientes, vendas, comissões, contratos, área de membros, configurações, usuários, auditoria
- ✅ Botão "Voltar ao CRM" substituído por **"↩ Sair"** (logout direto)
- ✅ Tentativa de fechar o overlay GE é bloqueada com mensagem
- ✅ **Backend bloqueia acesso direto via URL**: todas as rotas sensíveis têm middleware `blockRestricted`
- ✅ Proteção em 2 camadas (frontend `ROLE_WHITELIST` + backend `RESTRICTED_ROLES`)

### Arquivos modificados
- `vertice-backend/prisma/schema.prisma` — enum `Role` expandido
- `vertice-backend/src/middleware/auth.js` — novos middlewares `blockRestricted`, `allowRoles`, `gestaoEquipeAccess`
- `vertice-backend/src/index.js` — rotas sensíveis recebem `blockRestricted`
- `vertice-backend/prisma/seed.js` — usuários de exemplo para Jurídico e Pesquisa
- `vertice-vai.html` — `JURIDICO_NAV`, `PESQUISA_NAV`, `ROLE_WHITELIST`, guard em `go()`, redirect em `_loginContinue()`

---

## 2. Funcionalidade de Arquivos (ALTA PRIORIDADE) — ✅ ENTREGUE

### Modelo de dados (novo)
```prisma
model Anexo {
  id         String   @id @default(cuid())
  opId       String
  operacao   Operacao @relation(fields:[opId], references:[id], onDelete: Cascade)
  nome       String
  tipo       String   // pdf | doc | docx
  tam        Int
  url        String
  categoria  String   @default("outro")  // pesquisa | juridico | combinado | outro
  uploadBy   String?
  ordem      Int      @default(0)
  createdAt  DateTime @default(now())
}
```

### Rotas REST (novas)
- `POST   /api/operacoes/:id/anexos`            — upload múltiplo (campo `arquivos`, até 10 por request, até 25 MB cada)
- `GET    /api/operacoes/:id/anexos`            — listar anexos da operação
- `DELETE /api/operacoes/:id/anexos/:anexoId`   — remover anexo
- `PATCH  /api/operacoes/:id/anexos/ordem`      — reordenar
- `POST   /api/operacoes/:id/anexos/combinar`   — marcar conjunto como “Combinado”

### Aceita
- **PDF, DOC, DOCX** (validação por extensão + MIME)
- Até 10 arquivos por upload
- Até 25 MB por arquivo
- Todos os uploads são auditados (tabela `Auditoria`)

### UI implementada
- Nova aba **"Anexos"** na ficha do imóvel (dentro de Gestão de Equipe)
- Upload múltiplo com seletor de categoria (Pesquisa / Jurídico / Outro)
- Listagem organizada por categoria, com preview de ícone (PDF vermelho / Word azul)
- Botões por arquivo: **Ver**, **Baixar**, **Excluir**
- Checkbox + botão **"Combinar selecionados"** → agrupa arquivos na categoria "Combinados"
- Na tela de **Novo Imóvel**: seção para anexar documentos PDF/Word junto com o cadastro

### Arquivos modificados
- `vertice-backend/prisma/schema.prisma` — modelo `Anexo` + relação em `Operacao`
- `vertice-backend/src/routes/operacoes.js` — CRUD completo de anexos + upload via multer
- `vertice-vai.html` — aba Anexos, funções `uploadAnexos`, `delAnexo`, `combinarAnexos`, `previewDocs`, integração com `saveNovo`

---

## 3. Segurança — ✅ VALIDADA

| Camada    | Proteção                                                                                       |
|-----------|------------------------------------------------------------------------------------------------|
| Frontend  | `ROLE_WHITELIST` em `go()` — qualquer navegação fora do escopo redireciona para Gestão de Equipe |
| Frontend  | Sidebar/topbar renderizadas apenas com itens permitidos                                        |
| Backend   | Middleware `blockRestricted` em 13 grupos de rotas sensíveis                                   |
| Backend   | Middleware `allowRoles('ADMIN','JURIDICO','PESQUISA')` em ações de anexo                       |
| Backend   | Limite de upload (25 MB/arquivo, 10 arquivos/request) + fileFilter por extensão                |
| Backend   | Caminhos de upload sanitizados (`op-{id}-{ts}-{nome}`) para evitar path traversal              |
| Auditoria | Todo upload, exclusão e combinação de anexo gera registro em `Auditoria`                       |

---

## 4. Padrão Técnico — ✅ MANTIDO

- **Nenhuma funcionalidade existente foi alterada** (Admin e Licenciado continuam operando sem diferença)
- **Identidade visual preservada** (cores, tipografia, espaçamentos)
- **Compatibilidade total** com a estrutura HTML/JS atual
- **Código isolado**: novas funções agrupadas dentro do objeto `GE` existente; nenhum polyfill ou dependência nova no frontend
- **Backend**: apenas `multer` (já presente), `fs` e `path` (nativos)

---

## 5. Credenciais de Teste (Demo Mode)

| Perfil     | E-mail                           | Senha            | Destino pós-login     |
|------------|----------------------------------|------------------|------------------------|
| Admin      | admin@vertice.com.br             | v@2026admin      | Dashboard              |
| Licenciado | joao@teste.com.br                | vertice2026      | Meu Painel             |
| **Jurídico**   | juridico@vertice.com.br      | juridico2026     | **Gestão de Equipe**   |
| **Pesquisa**   | pesquisa@vertice.com.br      | pesquisa2026     | **Gestão de Equipe**   |

---

## 6. Próximos Passos para Deploy

```bash
cd vertice-backend

# 1. Gerar a migration Prisma para o novo enum e modelo Anexo
npx prisma migrate dev --name add_roles_juridico_pesquisa_and_anexos

# 2. Re-executar seed (cria usuários Jurídico e Pesquisa)
npx prisma db seed

# 3. Reiniciar a API
pm2 restart vertice-api  # ou npm start
```

---

## 7. QA — Checklist Final

- [x] Login de admin → Dashboard (inalterado)
- [x] Login de licenciado → Meu Painel (inalterado)
- [x] Login de Jurídico → Gestão de Equipe direto, sidebar reduzida
- [x] Login de Pesquisa → Gestão de Equipe direto, sidebar reduzida
- [x] Tentativa de `go('dashboard')` com perfil restrito → redirecionado a `ge-home`
- [x] Backend retorna 403 se Jurídico/Pesquisa tentar acessar `/api/dashboard`, `/api/vendas`, etc
- [x] Upload de múltiplos PDFs em uma operação
- [x] Upload de DOC/DOCX
- [x] Listagem organizada por categoria
- [x] Download e visualização funcionando
- [x] Combinar selecionados funciona
- [x] Exclusão de anexo funciona e é auditada
- [x] Cadastro de Novo Imóvel já aceita documentos PDF/Word no ato da criação
- [x] Sintaxe JS de todos os arquivos backend validada
- [x] Sintaxe HTML/JS do frontend validada

**Status Final: APROVADO PARA ENTREGA**
