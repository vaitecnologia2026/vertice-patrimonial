const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('Seed iniciado...');

  await prisma.configuracao.upsert({
    where:{id:'singleton'}, update:{},
    create:{id:'singleton',nomeEmpresa:'Vertice',corPrimaria:'#F87131',corSidebar:'#FDFEFF',corBG:'#F4F6F9',corCard:'#FFFFFF'}
  });

  const l1 = await prisma.licenciado.upsert({ where:{cnpj:'12.345.678/0001-90'}, update:{}, create:{
    id:'L001',nome:'Joao Teste',empresa:'Teste Parceiros LTDA',cnpj:'12.345.678/0001-90',
    estado:'SP',email:'joao@teste.com.br',tel:'(11) 98765-4321',
    status:'ATIVO',meta:3000000,inicio:new Date('2024-01-15'),ano:2,taxa:'isento',comHE:1.0
  }});
  const l3 = await prisma.licenciado.upsert({ where:{cnpj:'11.222.333/0001-44'}, update:{}, create:{
    id:'L003',nome:'Roberto Lima',empresa:'Lima & Associados',cnpj:'11.222.333/0001-44',
    estado:'MG',email:'roberto@lima.com.br',tel:'(31) 96543-2109',
    status:'ATIVO',meta:3000000,inicio:new Date('2023-08-20'),ano:3,taxa:'isento',comHE:1.5
  }});
  await prisma.licenciado.upsert({ where:{cnpj:'98.765.432/0001-10'}, update:{}, create:{
    id:'L002',nome:'Maria Costa',empresa:'Costa Negocios ME',cnpj:'98.765.432/0001-10',
    estado:'RJ',email:'maria@costa.com.br',tel:'(21) 97654-3210',
    status:'ATIVO',meta:3000000,inicio:new Date('2024-03-10'),ano:2,taxa:'cobrado',comHE:1.0
  }});
  console.log('  Licenciados criados');

  // Credenciais alinhadas com o frontend
  const adminHash    = await bcrypt.hash('v@2026admin', 12);
  const licHash      = await bcrypt.hash('vertice2026', 12);
  const juridicoHash = await bcrypt.hash('juridico2026', 12);
  const pesquisaHash = await bcrypt.hash('pesquisa2026', 12);

  await prisma.user.upsert({ where:{email:'admin@vertice.com.br'}, update:{password:adminHash}, create:{
    email:'admin@vertice.com.br', password:adminHash, name:'Ana Vertice', role:'ADMIN'
  }});
  await prisma.user.upsert({ where:{email:'joao@teste.com.br'}, update:{password:licHash}, create:{
    email:'joao@teste.com.br', password:licHash, name:'Joao Teste', role:'LIC', licId:l1.id
  }});
  await prisma.user.upsert({ where:{email:'roberto@lima.com.br'}, update:{password:licHash}, create:{
    email:'roberto@lima.com.br', password:licHash, name:'Roberto Lima', role:'LIC', licId:l3.id
  }});

  // Novos perfis restritos — acesso SOMENTE a Gestão de Equipe
  await prisma.user.upsert({ where:{email:'juridico@vertice.com.br'}, update:{password:juridicoHash, role:'JURIDICO'}, create:{
    email:'juridico@vertice.com.br', password:juridicoHash, name:'Dra. Patricia Melo', role:'JURIDICO'
  }});
  await prisma.user.upsert({ where:{email:'pesquisa@vertice.com.br'}, update:{password:pesquisaHash, role:'PESQUISA'}, create:{
    email:'pesquisa@vertice.com.br', password:pesquisaHash, name:'Ana Costa', role:'PESQUISA'
  }});
  console.log('  Usuarios criados (incluindo Juridico e Pesquisa)');

  const c1 = await prisma.cliente.upsert({ where:{cpf:'123.456.789-09'}, update:{}, create:{
    id:'C001',nome:'Carlos Mendes',cpf:'123.456.789-09',tel:'(11) 98765-4321',
    email:'carlos@email.com',orig:'Indicacao',licId:l1.id,prod:'Arrematacao Individual',
    status:'ATIVO',end:'Av. Paulista, 1578, SP'
  }});
  const c2 = await prisma.cliente.upsert({ where:{cpf:'987.654.321-00'}, update:{}, create:{
    id:'C002',nome:'Ana Paula Souza',cpf:'987.654.321-00',tel:'(21) 97654-3210',
    email:'ana@email.com',orig:'Instagram',licId:l1.id,prod:'Home Equity',
    status:'ATIVO',end:'Rua Copacabana, 300, RJ'
  }});
  const c3 = await prisma.cliente.upsert({ where:{cpf:'529.982.247-25'}, update:{}, create:{
    id:'C004',nome:'Beatriz Nunes',cpf:'529.982.247-25',tel:'(41) 95432-1098',
    email:'beatriz@email.com',orig:'Google',licId:l1.id,prod:'Arrematacao Individual',
    status:'FECHADO'
  }});
  console.log('  Clientes criados');

  const v1 = await prisma.venda.upsert({ where:{id:'VND-2026-0847'}, update:{}, create:{
    id:'VND-2026-0847',cliId:c3.id,licId:l1.id,prod:'Arrematacao Individual',
    val:1100000,canal:'Licenciado',status:'FECHADA',comStatus:'pago',data:new Date('2026-03-28')
  }});
  await prisma.comissao.upsert({ where:{id:'COM-001'}, update:{}, create:{
    id:'COM-001',vendaId:v1.id,licId:l1.id,prod:'Arrematacao Individual',
    valNeg:1100000,regra:'>=R$1M: 10% empresa -> 30% licenciado',
    comEmpresa:110000,val:33000,comAdv:1650,comAna:1650,netEmpresa:73700,
    status:'PAGO',data:new Date('2026-03-30')
  }});
  console.log('  Vendas e comissoes criadas');

  await prisma.kanbanCard.upsert({ where:{id:'KB001'}, update:{}, create:{
    id:'KB001',cliId:c1.id,licId:l1.id,col:'Prospeccao',prod:'Arrematacao Individual',val:450000,dias:2
  }});
  await prisma.kanbanCard.upsert({ where:{id:'KB002'}, update:{}, create:{
    id:'KB002',cliId:c2.id,licId:l1.id,col:'Qualificado',prod:'Home Equity',val:300000,dias:4
  }});
  console.log('  Kanban criado');

  await prisma.operacao.upsert({ where:{id:'OP001'}, update:{}, create:{
    id:'OP001',tipo:'ARREMATA',licId:l1.id,
    end:'Rua Vergueiro, 3200 - Vila Mariana',bairro:'Vila Mariana',cidade:'Sao Paulo',
    tipo_imovel:'apartamento',modalidade:'extrajudicial',status:'em_analise',mes:'Abril',
    leilao:new Date('2026-04-25T10:00:00'),lance:145000,aval:320000,deb:18000,ref:25000
  }});

  await prisma.meta.upsert({ where:{id:'META001'}, update:{}, create:{
    id:'META001',licId:l1.id,periodo:'Q2/2026',meta:3000000,realizado:2340000
  }});
  await prisma.meta.upsert({ where:{id:'META002'}, update:{}, create:{
    id:'META002',licId:l3.id,periodo:'Q2/2026',meta:3000000,realizado:4100000
  }});

  await prisma.consorcio.upsert({ where:{id:'CO001'}, update:{}, create:{
    id:'CO001',tipo:'imovel',nome:'Consorcio Imobiliario Caixa - Carta R$ 300.000',
    admin:'Caixa Economica Federal',carta:'R$ 300.000,00',prazo:'120',
    parcela:'R$ 2.500,00',taxa:'1.20',comissao:'1.50',visivel:true,status:'aprovado'
  }});

  const curso = await prisma.curso.upsert({ where:{id:'CURSO001'}, update:{}, create:{
    id:'CURSO001',titulo:'Metodo VAI - Fundamentos',
    desc:'Aprenda as bases do sistema Vertice e o Metodo VAI de vendas.',ativo:true,ordem:1
  }});
  const mod = await prisma.modulo.upsert({ where:{id:'MOD001'}, update:{}, create:{
    id:'MOD001',cursoId:curso.id,titulo:'Modulo 1 - Introducao ao Vertice',ordem:1
  }});
  await prisma.aula.upsert({ where:{id:'AULA001'}, update:{}, create:{
    id:'AULA001',moduloId:mod.id,titulo:'Bem-vindo ao Vertice',
    video:'https://youtube.com/watch?v=demo',
    desc:'Visao geral da plataforma e primeiros passos.',ordem:1
  }});
  console.log('  Cursos, metas, consorcios, operacoes criados');

  console.log('\nSeed concluido!\n');
  console.log('Credenciais de acesso:');
  console.log('  Admin:       admin@vertice.com.br     /  v@2026admin');
  console.log('  Licenciado:  joao@teste.com.br        /  vertice2026');
  console.log('  Juridico:    juridico@vertice.com.br  /  juridico2026');
  console.log('  Pesquisa:    pesquisa@vertice.com.br  /  pesquisa2026');
}
main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
