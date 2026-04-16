# Vertice — Guia de Instalacao

## Requisitos do Sistema

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 14
- **npm** >= 9
- **PM2** (para producao): `npm install -g pm2`
- **Nginx** (para servir frontend e proxy reverso)

---

## 1. Clonar / Copiar o Projeto

```bash
# Copiar os arquivos para o servidor
scp -r vertice-backend/ usuario@servidor:/var/www/vertice-api/
scp vertice-vai.html usuario@servidor:/var/www/vertice/vertice-vai.html
```

---

## 2. Configurar o Banco de Dados (PostgreSQL)

```bash
# Acessar o PostgreSQL
sudo -u postgres psql

# Criar usuario e banco
CREATE USER vertice_user WITH PASSWORD 'TROQUE_POR_SENHA_FORTE';
CREATE DATABASE vertice_db OWNER vertice_user;
GRANT ALL PRIVILEGES ON DATABASE vertice_db TO vertice_user;
\q
```

---

## 3. Configurar Variaveis de Ambiente

```bash
cd /var/www/vertice-api
cp .env.example .env
nano .env
```

Preencher o arquivo `.env`:

```env
# BANCO DE DADOS
DATABASE_URL="postgresql://vertice_user:SUA_SENHA@localhost:5432/vertice_db?schema=public"

# JWT — gerar strings aleatorias com: openssl rand -base64 32
JWT_SECRET="COLE_AQUI_STRING_ALEATORIA_1"
JWT_REFRESH_SECRET="COLE_AQUI_STRING_ALEATORIA_2"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# SERVIDOR
PORT=4000
NODE_ENV=production
CORS_ORIGIN="https://seudominio.com.br"

# UPLOAD
UPLOAD_DIR="./uploads"
MAX_FILE_SIZE_MB=10

# LOGS
LOG_LEVEL=info
```

**Gerar JWT Secrets:**
```bash
openssl rand -base64 32  # Copiar resultado para JWT_SECRET
openssl rand -base64 32  # Copiar resultado para JWT_REFRESH_SECRET
```

---

## 4. Instalar Dependencias

```bash
cd /var/www/vertice-api
npm install
```

---

## 5. Criar Tabelas no Banco

```bash
# Gerar o Prisma Client
npx prisma generate

# Aplicar o schema no banco (cria enum JURIDICO/PESQUISA e tabela Anexo)
npx prisma migrate deploy
# (em dev, use: npx prisma migrate dev --name add_roles_and_anexos)

# Popular com dados iniciais (opcional)
npm run db:seed
```

**Credenciais de acesso apos o seed (v3.1):**

| Perfil      | Email                        | Senha            | Acesso                       |
|-------------|------------------------------|------------------|------------------------------|
| Admin       | admin@vertice.com.br         | v@2026admin      | Total                        |
| Licenciado  | joao@teste.com.br            | vertice2026      | CRM, Vendas, Comissoes       |
| Juridico    | juridico@vertice.com.br      | juridico2026     | Apenas Gestao de Equipe      |
| Pesquisa    | pesquisa@vertice.com.br      | pesquisa2026     | Apenas Gestao de Equipe      |

> **IMPORTANTE:** Troque as senhas padrao imediatamente apos o primeiro login.

---

## 6. Testar Localmente

```bash
# Modo desenvolvimento
npm run dev

# Testar se a API responde
curl http://localhost:4000/health
```

Resposta esperada:
```json
{"status":"ok","version":"3.1.0","timestamp":"...","uptime":...}
```

---

## 7. Subir em Producao

### 7.1 Iniciar com PM2

```bash
cd /var/www/vertice-api
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Seguir as instrucoes exibidas
```

### 7.2 Verificar Status

```bash
pm2 status
pm2 logs vertice-api
```

### 7.3 Comandos Uteis PM2

```bash
pm2 restart vertice-api   # Reiniciar
pm2 stop vertice-api      # Parar
pm2 delete vertice-api    # Remover
pm2 monit                 # Monitor em tempo real
```

---

## 8. Configurar Nginx

```bash
# Copiar configuracao
sudo cp nginx.conf /etc/nginx/sites-available/vertice
sudo ln -s /etc/nginx/sites-available/vertice /etc/nginx/sites-enabled/

# Editar o arquivo — trocar "seudominio.com.br" pelo seu dominio
sudo nano /etc/nginx/sites-available/vertice

# Testar configuracao
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
```

---

## 9. Configurar SSL com Certbot

```bash
# Instalar Certbot
sudo apt install certbot python3-certbot-nginx -y

# Gerar certificado SSL
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br

# Renovacao automatica (ja configurada pelo Certbot)
sudo certbot renew --dry-run
```

---

## 10. Seguranca Basica

### Checklist de seguranca:

- [ ] Trocar todas as senhas padrao
- [ ] Configurar `JWT_SECRET` e `JWT_REFRESH_SECRET` com strings aleatorias
- [ ] Definir `CORS_ORIGIN` com o dominio correto (nao usar `*` em producao)
- [ ] Configurar firewall (UFW):

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

- [ ] Manter Node.js e dependencias atualizadas
- [ ] Configurar backups automaticos do PostgreSQL:

```bash
# Backup manual
pg_dump -U vertice_user vertice_db > backup_$(date +%Y%m%d).sql

# Cron para backup diario (adicionar ao crontab)
# crontab -e
0 2 * * * pg_dump -U vertice_user vertice_db > /backups/vertice_$(date +\%Y\%m\%d).sql
```

---

## 11. Erros Comuns

### Erro: "ECONNREFUSED" ao conectar no banco
- Verificar se PostgreSQL esta rodando: `sudo systemctl status postgresql`
- Verificar credenciais no `.env`
- Verificar se o usuario tem permissao no banco

### Erro: "CORS blocked"
- Verificar se `CORS_ORIGIN` no `.env` esta correto
- Deve ser a URL completa: `https://seudominio.com.br`

### Erro: "Token expirado" constante
- Verificar se o frontend esta chamando `/api/auth/refresh` antes de expirar
- `JWT_EXPIRES_IN` padrao e 15 minutos

### Erro: "Port already in use"
```bash
# Verificar o que esta usando a porta
lsof -i :4000
# Matar o processo se necessario
kill -9 <PID>
```

### Erro no upload de arquivos
- Verificar se a pasta `uploads/` existe e tem permissao de escrita
- Verificar `MAX_FILE_SIZE_MB` no `.env`
- Extensoes permitidas: pdf, doc, docx, xls, xlsx, csv, jpg, jpeg, png, gif, webp, svg, txt, zip, rar

### Prisma: "Schema drift detected"
```bash
npx prisma db push --accept-data-loss  # CUIDADO: pode perder dados
# Ou usar migrations:
npx prisma migrate dev
```

---

## 12. Estrutura de Pastas

```
vertice-backend/
  prisma/
    schema.prisma    # Schema do banco de dados
    seed.js          # Dados iniciais
  src/
    index.js         # Ponto de entrada
    middleware/
      auth.js        # Autenticacao JWT
      errorHandler.js # Tratamento de erros
    routes/
      auth.js        # Login/logout/refresh
      licenciados.js # CRUD licenciados
      clientes.js    # CRUD clientes
      vendas.js      # CRUD vendas + comissao auto
      comissoes.js   # Gestao de comissoes
      operacoes.js   # Operacoes (arremat/HE/etc)
      contratos.js   # Contratos blockchain-hash
      documentos.js  # Upload de documentos
      metas.js       # Metas por periodo
      consorcios.js  # Catalogo de consorcios
      cursos.js      # Area de membros
      config.js      # Configuracao visual
      auditoria.js   # Logs de auditoria
      usuarios.js    # Gestao de usuarios
      kanban.js      # CRM Kanban
      dashboard.js   # Metricas/dashboard
    utils/
      prisma.js      # Prisma singleton
      sanitize.js    # Validacao e sanitizacao
      logger.js      # Winston logger
  uploads/           # Arquivos enviados
  logs/              # Logs do sistema
  .env.example       # Modelo de configuracao
  ecosystem.config.js # Configuracao PM2
  nginx.conf         # Configuracao Nginx
  package.json

vertice-vai.html     # Frontend (SPA completo)
```

---

## 13. Atualizacoes

Para atualizar o sistema:

```bash
cd /var/www/vertice-api

# Atualizar codigo
# (copiar novos arquivos ou git pull)

# Instalar novas dependencias
npm install

# Atualizar banco se necessario
npx prisma db push

# Reiniciar
pm2 restart vertice-api
```

---

## Suporte

- Logs da API: `pm2 logs vertice-api`
- Logs de erro: `cat logs/error.log`
- Status do banco: `npx prisma studio` (abre interface visual)
- Health check: `curl https://seudominio.com.br/health`
