const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  // Configuração padrão (necessária para o app funcionar)
  await prisma.configuracao.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      nomeEmpresa: 'Vertice',
      corPrimaria: '#F87131',
      corSidebar: '#FDFEFF',
      corBG: '#F4F6F9',
      corCard: '#FFFFFF',
    },
  });

  const adminHash = await bcrypt.hash('v@2026admin', 12);

  await prisma.user.upsert({
    where: { email: 'admin@vertice.com.br' },
    update: { password: adminHash },
    create: {
      email: 'admin@vertice.com.br',
      password: adminHash,
      name: 'Admin Vertice',
      role: 'ADMIN',
    },
  });

  console.log('Pronto!');
  console.log('  Admin: admin@vertice.com.br / v@2026admin');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
