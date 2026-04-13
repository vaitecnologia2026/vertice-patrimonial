/**
 * Permite apenas campos específicos do req.body — previne mass assignment.
 * @param {object} body - req.body
 * @param {string[]} allowed - campos permitidos
 * @returns {object} objeto filtrado
 */
function pick(body, allowed) {
  const out = {};
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

/**
 * Valida CPF (formato 000.000.000-00 ou apenas números).
 * Retorna CPF formatado ou null se inválido.
 */
function formatCPF(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 11) return null;
  // Rejeita sequências iguais
  if (/^(\d)\1{10}$/.test(digits)) return null;
  // Validação dos dígitos verificadores
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (parseInt(digits[9]) !== d1) return null;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  if (parseInt(digits[10]) !== d2) return null;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/**
 * Valida CNPJ (formato 00.000.000/0001-00 ou apenas números).
 * Retorna CNPJ formatado ou null se inválido.
 */
function formatCNPJ(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 14) return null;
  if (/^(\d)\1{13}$/.test(digits)) return null;
  const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * weights1[i];
  let d1 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (parseInt(digits[12]) !== d1) return null;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i]) * weights2[i];
  let d2 = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (parseInt(digits[13]) !== d2) return null;
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

/**
 * Extensões de arquivo permitidas para upload.
 */
const ALLOWED_FILE_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.txt', '.zip', '.rar',
];

function isAllowedFile(filename) {
  if (!filename) return false;
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.includes(ext);
}

module.exports = { pick, formatCPF, formatCNPJ, isAllowedFile, ALLOWED_FILE_EXTENSIONS };
