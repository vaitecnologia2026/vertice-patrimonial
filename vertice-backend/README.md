# VÉRTICE v3.0 — Backend API
> VAI Inteligência Comercial · Sistema Integrado de Licenciamento

---

## CREDENCIAIS DE ACESSO

| Perfil | Email | Senha |
|--------|-------|-------|
| Admin | admin@vertice.com.br | v@2026 |
| Licenciado | joao@teste.com.br | 123456 |

---

## INSTALAÇÃO RÁPIDA

```bash
# 1. Entrar no diretório
cd vertice-backend

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas configurações

# 4. Gerar cliente Prisma
npm run db:generate

# 5. Criar tabelas
npm run db:push

# 6. Popular com dados demo
npm run db:seed

# 7. Iniciar
npm run dev          # desenvolvimento
npm start            # produção
```

---

## VARIÁVEIS DE AMBIENTE (.env)

```env
DATABASE_URL="postgresql://vertice_user:SENHA@localhost:5432/vertice_db"
JWT_SECRET="string-aleatoria-256-bits"
JWT_REFRESH_SECRET="outra-string-aleatoria-256-bits"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=4000
NODE_ENV=production
CORS_ORIGIN="https://seudominio.com.br"
```

---

## CONFIGURAR O FRONTEND PARA USAR A API

Editar `vertice-vai.html` e adicionar antes do `</body>`:

```html
<script>window.__VERTICE_API__ = 'https://api.seudominio.com.br';</script>
```

Sem esta linha, o frontend opera em **modo local** (localStorage) — totalmente funcional sem backend.

---

## DEPLOY EM PRODUÇÃO (VPS Ubuntu 20.04+)

### 1. PostgreSQL

```bash
sudo -u postgres psql << SQL
CREATE USER vertice_user WITH PASSWORD 'SENHA_FORTE';
CREATE DATABASE vertice_db OWNER vertice_user;
GRANT ALL PRIVILEGES ON DATABASE vertice_db TO vertice_user;
SQL
```

### 2. Backend

```bash
sudo mkdir -p /var/www/vertice-api && cd /var/www/vertice-api
cp -r /caminho/vertice-backend/* .
npm ci --omit=dev
cp .env.example .env && nano .env
npm run db:generate && npm run db:migrate && npm run db:seed
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

### 3. Frontend

```bash
sudo mkdir -p /var/www/vertice
cp vertice-vai.html /var/www/vertice/index.html
# Injetar URL da API:
sed -i 's|</body>|<script>window.__VERTICE_API__="https://api.seudominio.com.br";</script></body>|' /var/www/vertice/index.html
```

### 4. Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/vertice
# Editar domínio em nginx.conf
sudo ln -s /etc/nginx/sites-available/vertice /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. SSL

```bash
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br
```

---

## ENDPOINTS DISPONÍVEIS

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/login | Login — retorna access + refresh token |
| POST | /api/auth/refresh | Renovar access token |
| POST | /api/auth/logout | Logout |
| GET  | /api/auth/me | Dados do usuário logado |
| GET/POST/PUT | /api/licenciados | CRUD licenciados |
| GET/POST/PUT | /api/clientes | CRUD clientes + check CPF |
| GET/POST/PUT | /api/vendas | CRUD vendas + comissão auto |
| GET/PATCH | /api/comissoes | Listagem + marcar pago |
| GET/POST/PUT | /api/operacoes | CRUD operações (Arrematação, HE, Revisão, Clube) |
| GET/POST | /api/contratos | Contratos + hash SHA256 |
| GET/POST/PATCH | /api/kanban | CRM Kanban + mover cards |
| GET/POST | /api/documentos | Upload + CRUD documentos |
| GET/POST/PUT | /api/metas | Metas por licenciado |
| GET/POST/PUT/DELETE | /api/consorcios | CRUD consórcios + visibilidade |
| GET/POST | /api/cursos | Área de membros — cursos/módulos/aulas |
| GET/PUT | /api/config | Configuração white-label |
| GET | /api/auditoria | Log de auditoria (admin only) |
| GET/POST/PATCH | /api/usuarios | CRUD usuários + troca de senha |
| GET | /api/dashboard | KPIs consolidados |
| GET | /health | Health check |

---

## SEGURANÇA

- JWT access 15min + refresh rotativo 7 dias
- bcrypt 12 rounds
- RBAC: ADMIN / LIC
- Rate limiting: 300 req/15min global · 10 tentativas login/15min
- Helmet.js + CORS configurado
- Auditoria automática de ações críticas
- Headers de segurança via Nginx

---

## BACKUP

```bash
# Exportar banco
pg_dump -U vertice_user vertice_db > backup_$(date +%Y%m%d).sql

# Restaurar
psql -U vertice_user vertice_db < backup_20260411.sql

# Backup automático diário (cron às 3h)
(crontab -l; echo "0 3 * * * pg_dump -U vertice_user vertice_db > /backups/vertice_\$(date +\%Y\%m\%d).sql") | crontab -
```

---

**Vértice v3.0 · VAI Inteligência Comercial · Abril 2026**
