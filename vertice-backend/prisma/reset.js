require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  console.log('Iniciando limpeza...')

  try {
    await prisma.auditoria.deleteMany()
    console.log('auditoria ok')
    await prisma.refreshToken.deleteMany()
    console.log('refreshToken ok')
    await prisma.documento.deleteMany()
    console.log('documento ok')
    await prisma.comissao.deleteMany()
    console.log('comissao ok')
    await prisma.kanbanCard.deleteMany()
    console.log('kanbanCard ok')
    await prisma.contrato.deleteMany()
    console.log('contrato ok')
    await prisma.venda.deleteMany()
    console.log('venda ok')
    await prisma.cliente.deleteMany()
    console.log('cliente ok')
    await prisma.meta.deleteMany()
    console.log('meta ok')
    await prisma.consorcio.deleteMany()
    console.log('consorcio ok')
    await prisma.operacao.deleteMany()
    console.log('operacao ok')
    await prisma.curso.deleteMany()
    console.log('curso ok')
    await prisma.user.deleteMany()
    console.log('user ok')
    await prisma.licenciado.deleteMany()
    console.log('licenciado ok')

    const senhaHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'v@2026admin', 12)
    await prisma.user.create({
      data: {
        name: 'Administrador',
        email: 'admin@vertice.com.br',
        password: senhaHash,
        role: 'ADMIN',
        ativo: true,
      }
    })

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
    })

    console.log('Admin criado! Login: admin@vertice.com.br')
  } catch (e) {
    console.error('ERRO:', e.message)
  } finally {
    await prisma.$disconnect()
  }
}

main()
