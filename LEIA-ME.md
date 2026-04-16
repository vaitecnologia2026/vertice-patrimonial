# Vertice v3.1 — Pacote de Entrega

**Sistema Integrado de Licenciamento — VAI Inteligencia Comercial**
**Data:** Abril 2026
**Versao:** 3.1

---

## O Que Esta Neste Pacote

```
Projeto Vertice v3.1/
├── LEIA-ME.md                   ← Este arquivo (comece aqui)
├── CHANGELOG-PERFIS.md          ← Detalhamento das novidades da v3.1
├── instalacao.md                ← Guia passo-a-passo de deploy
├── vertice-vai.html             ← Frontend (arquivo unico, 9800+ linhas)
├── logo-pegasus-gold.jpg        ← Logo oficial
├── logo-vertice.svg             ← Logo vetorial
└── vertice-backend/             ← API Node.js + Prisma + PostgreSQL
    ├── README.md                ← Documentacao tecnica do backend
    ├── package.json
    ├── .env.example             ← Template de variaveis de ambiente
    ├── ecosystem.config.js      ← Config do PM2
    ├── nginx.conf               ← Config do Nginx
    ├── prisma/
    │   ├── schema.prisma        ← Schema do banco (com enum Role e modelo Anexo)
    │   └── seed.js              ← Dados iniciais (com usuarios Juridico e Pesquisa)
    └── src/
        ├── index.js
        ├── middleware/auth.js   ← Controle de acesso por perfil
        ├── routes/              ← 16 grupos de rotas REST
        └── utils/
```

---

## 2 Formas de Usar

### 1) Modo Demo (sem instalar nada)

Abra o arquivo `vertice-vai.html` direto no navegador (duplo-clique ou arraste para o Chrome).
Tudo funciona em modo local, sem banco de dados, usando localStorage.

**Emails de teste:**

| Perfil      | Email                        | Acesso                  |
|-------------|------------------------------|-------------------------|
| Admin       | admin@vertice.com.br         | Total                   |
| Licenciado  | joao@teste.com.br            | CRM e Vendas            |
| Juridico    | juridico@vertice.com.br      | Gestao de Equipe apenas |
| Pesquisa    | pesquisa@vertice.com.br      | Gestao de Equipe apenas |

**Em modo demo, qualquer senha funciona** (so o email e validado).

### 2) Modo Producao (instalacao completa)

Siga o `instalacao.md` passo a passo para subir o backend com PostgreSQL + Nginx + SSL.

---

## Novidades da v3.1

### Controle de Acesso Granular

- **Novos perfis:** Juridico e Pesquisa
- Redirecionamento automatico para Gestao de Equipe apos login
- Sidebar reduzida, sem acesso a Dashboard/Financeiro/Comissoes
- Bloqueio no backend: qualquer URL direta retorna 403

### Upload de Arquivos em Operacoes

- Nova aba **Anexos** na ficha do imovel (Gestao de Equipe)
- Upload multi-arquivo: PDF, DOC, DOCX (ate 10 por vez)
- Organizacao por categoria: Pesquisa, Juridico, Combinado, Outro
- Funcao de **combinar** documentos (agrupamento logico)
- Download, visualizacao e exclusao com auditoria

### Tela de Novo Imovel

- Ao cadastrar um imovel, e possivel ja anexar documentos PDF/Word

---

## Comandos Essenciais

### Primeira Instalacao

```bash
cd vertice-backend
npm install
cp .env.example .env       # Edite com suas configuracoes
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run dev                # ou: pm2 start ecosystem.config.js
```

### Atualizacao de v3.0 para v3.1

```bash
cd vertice-backend
git pull                    # ou copie os arquivos novos
npm install
npx prisma migrate deploy   # Aplica enum novo e tabela Anexo
npm run db:seed             # Cria os 2 novos usuarios
pm2 restart vertice-api
```

### Conectar Frontend a API

Antes de `</body>` no `vertice-vai.html`, adicione:

```html
<script>window.__VERTICE_API__ = 'https://api.seudominio.com.br';</script>
```

Sem essa linha, o frontend roda em modo demo (localStorage).

---

## Seguranca

- JWT access 15min + refresh rotativo 7 dias
- bcrypt 12 rounds
- 4 perfis (RBAC): ADMIN, LIC, JURIDICO, PESQUISA
- Rate limiting em login e uploads
- Helmet.js + CORS
- Auditoria automatica (tabela Auditoria) em todas as acoes criticas
- Sanitizacao de nomes de arquivo
- Validacao dupla: frontend (whitelist) + backend (middleware)

---

## Suporte

- **Backend:** `vertice-backend/README.md`
- **Instalacao:** `instalacao.md`
- **Novidades tecnicas:** `CHANGELOG-PERFIS.md`
- **API URL:** https://api.seudominio.com.br (configuravel)
- **Frontend URL:** https://seudominio.com.br

---

**Vertice v3.1 · VAI Inteligencia Comercial · Abril 2026**
