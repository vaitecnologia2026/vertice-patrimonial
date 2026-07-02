// Cálculo do repasse de parceiro — FONTE ÚNICA (usado por partnerPayouts e partnerLeads).
// PERCENTUAL: % do valor-base; FIXO: valor fixo. Arredonda a 2 casas.
function calcularPayout(parceiro, valorBase) {
  const v = parseFloat(valorBase) || 0;
  if (parceiro.tipoComissao === 'PERCENTUAL') {
    return Math.round((v * (parseFloat(parceiro.valComissao) || 0) / 100) * 100) / 100;
  }
  return parseFloat(parceiro.valComissao) || 0;
}

module.exports = { calcularPayout };
