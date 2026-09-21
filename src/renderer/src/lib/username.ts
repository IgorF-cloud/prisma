// Mesma regra validada no token-server (ver isValidUsername em
// server.js). Só letras (sem acento) e números — nenhum caractere
// especial (vírgula, ponto, "-", "_", "/" etc.), case sensitive (sem
// normalizar maiúsculas/minúsculas em nenhum lugar).
const USERNAME_CHARSET_PATTERN = /^[A-Za-z0-9]*$/
const INVALID_CHAR_PATTERN = /[^A-Za-z0-9]/

export const USERNAME_ERROR_MESSAGE = 'Nome inválido. Use apenas letras e números.'

// Validação completa (usada no submit): não pode ficar vazio nem ter
// caractere fora do conjunto permitido.
export function isValidUsername(name: string): boolean {
  return name.length > 0 && USERNAME_CHARSET_PATTERN.test(name)
}

// Checagem por tecla digitada (usada no onChange, pra dar feedback
// instantâneo) — string vazia não é "inválida" aqui, senão o campo já
// nasceria vermelho antes do usuário digitar qualquer coisa.
export function hasInvalidUsernameChars(name: string): boolean {
  return INVALID_CHAR_PATTERN.test(name)
}
