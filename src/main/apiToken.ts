import { BrowserWindow } from 'electron'

// Token de API do usuário logado (2026-09-10) — item 3 do ROADMAP.
//
// SUBSTITUI o `API_TOKEN` que vinha do config.json: aquele era um segredo
// COMPARTILHADO, o mesmo em toda instalação, em texto puro do lado do
// .exe. Agora é um JWT por usuário, emitido pelo servidor no login/
// cadastro e válido por 30 dias.
//
// Mora num módulo próprio, e não em config.ts, por uma diferença que
// importa: a config é lida uma vez no boot e nunca muda; isto aqui muda
// em tempo de execução (login, logout, expirar). Todo request autenticado
// do main chama `authHeader()` na HORA de montar o fetch — se algum lugar
// guardar o valor numa constante no topo do arquivo, ele congela o token
// do momento em que o módulo carregou e para de funcionar depois de um
// logout/login.

let currentToken: string | null = null

export function setApiToken(token: string | null): void {
  currentToken = token
}

export function getApiToken(): string | null {
  return currentToken
}

// String vazia quando não há token: o servidor responde 401, que é o
// comportamento certo. Devolver `Bearer null` mascararia o problema num
// erro mais confuso.
export function authHeader(): string {
  return `Bearer ${currentToken ?? ''}`
}

// Avisa o renderer que a sessão morreu, pra ele voltar pra tela de login
// em vez de ficar mostrando erro em cada ação.
//
// Chamado de qualquer request que receba 401 (ver `handleUnauthorized`
// nos módulos que falam com a API). Limpa o token aqui também: sem isso,
// as chamadas seguintes continuariam mandando um token que já se sabe
// morto.
export function notifySessionExpired(): void {
  if (currentToken === null) return // já tratado, não repete o aviso
  currentToken = null
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('auth:session-expired')
  }
}
