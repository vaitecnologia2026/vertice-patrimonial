FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS prisma
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini curl && addgroup -S vertice && adduser -S vertice -G vertice
ENV NODE_ENV=production PORT=4000

COPY --from=deps   /app/node_modules ./node_modules
COPY --from=prisma /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma /app/node_modules/@prisma ./node_modules/@prisma
COPY package.json ./
COPY prisma ./prisma
COPY src ./src
COPY ecosystem.config.js ./

# Copia frontend PÚBLICO (vai ser servido pelo express)
COPY public ./public

RUN mkdir -p logs uploads && chown -R vertice:vertice /app
USER vertice
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -sf http://127.0.0.1:4000/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
