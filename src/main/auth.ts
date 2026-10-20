import { ipcMain } from 'electron'
import { API_BASE_URL, CLIENT_HEADER, CLIENT_HEADER_VALUE } from './config'
import { authHeader, notifySessionExpired, setApiToken } from './apiToken'
import { persistSessionToken, updateSessionUser } from './session'

// Roadmap item 43: avatar é OU um preset (ícone+cor, resolvido 100% no
// cliente, nunca passa pela rede além dessa `key`) OU uma foto
// customizada (upload comprimido pelo cliente, ver auth:uploadAvatar
// abaixo) — `id`/`version` de um avatar customizado servem pro cliente
// montar a URL (/avatars/<id>.webp?v=<version>, cache-buster).
export type AvatarRef =
  | { type: 'preset'; key: string }
  | { type: 'custom'; id: number; version: number; format?: 'webp' | 'gif' }

// Preferências da conta (2026-09-06) — o token-server sempre devolve
// esse objeto completo (defaults costurados na leitura, ver settingsOf no
// server.js), então nunca chega parcial aqui.
export interface UserSettings {
  alertForNewLives: boolean
  // Sobreposição de viewers na tela durante a live (2026-09-10).
  // Nasce DESLIGADA: ela desenha por cima da tela do usuário.
  showViewersOverlay: boolean
}

export interface AuthUser {
  id: number
  name: string
  // Só nas rotas do próprio usuário — o GET /users não traz.
  email: string
  avatar: AvatarRef | null
  settings: UserSettings
  // Preferencia de presenca (item 11). Duplicada aqui pelo mesmo motivo
  // do resto deste tipo: a fronteira de IPC nao importa do renderer.
  presence: 'available' | 'busy'
}

interface ApiErrorBody {
  // Só vem no 403 de conta não-ativa (ver STATUS_LOGIN_ERROR no
  // server.js).
  status?: string
  error: string
  // Preenchido pelo servidor em conflito de cadastro ("name" ou
  // "email") e na troca de senha ("currentPassword") — a tela usa pra
  // marcar o campo certo em vez de um erro solto no topo.
  field?: string
  // Código da recusa, pra tela reagir de um jeito próprio em vez de só
  // mostrar o texto. Dois hoje:
  //
  //   token_expired       o JWT venceu (ver auth/jwt.js no servidor)
  //   user_limit_reached  cadastro recusado por falta de vaga
  //                       (2026-09-18, ver withUserSlot no servidor)
  //
  // Código e não texto porque texto muda: a mensagem pode ser reescrita
  // a qualquer momento sem quebrar o app; o código, não.
  code?: string
}

// Erro com o campo culpado junto, pra tela conseguir destacar o input.
// Continua sendo um Error normal, então quem não liga pro campo trata
// igual a qualquer outro.
export class ApiFieldError extends Error {
  field?: string
  // Situação da conta, quando o servidor recusa por causa dela. Desde
  // 2026-09-18 sobrou uma: 'blocked'.
  //
  // ⚠️ Este campo NÃO atravessa o IPC — o Electron serializa só a
  // `message` de um erro lançado dentro de um `ipcMain.handle`. Ele
  // serve pro handler AQUI no main, que converte isso num resultado
  // de verdade antes de responder (ver auth:login abaixo).
  accountStatus?: string
  // Mesma história do acima, e mesmo cuidado com o IPC: o código de
  // recusa que a tela usa pra escolher o que mostrar. Ver `ApiErrorBody`.
  code?: string
  constructor(message: string, field?: string, accountStatus?: string, code?: string) {
    super(message)
    this.field = field
    this.accountStatus = accountStatus
    this.code = code
  }
}

// O que /login e /register devolvem desde 2026-09-10: o usuário E o
// JWT dele. As outras rotas continuam devolvendo só o usuário.
export interface AuthResult {
  user: AuthUser
  token: string
}

// Sem isso, servidor fora do ar/rede inalcançável travava a chamada
// indefinidamente (fetch nativo não tem timeout próprio) — pedido do
// usuário pra tratar esse caso com uma mensagem amigável em vez de
// travar ou vazar o erro cru (ex: "TypeError: fetch failed") pra tela.
const REQUEST_TIMEOUT_MS = 10000

// Genérica desde 2026-09-10: /login e /register devolvem AuthResult, o
// resto devolve AuthUser (e a troca de senha não devolve nada).
async function apiRequest<T>(method: string, path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(),
        // Plataforma + versão deste app (2026-09-21). O servidor usa no
        // `/login` pra registrar com o que a pessoa entrou; nas outras
        // rotas ele ignora, e o header vai junto porque está AQUI e não
        // em cada chamada — um header que cada rota decide mandar é um
        // header que a próxima rota esquece.
        [CLIENT_HEADER]: CLIENT_HEADER_VALUE
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    // AbortSignal.timeout() rejeita com um erro "TimeoutError" — qualquer
    // outra falha aqui (servidor fora do ar, DNS, sem rede) cai no genérico.
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('O servidor demorou demais para responder. Tente novamente.')
    }
    throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.')
  }

  // 204 (troca de senha) não tem corpo — `.json()` explodiria.
  if (response.status === 204) return undefined as T

  let data: T | ApiErrorBody
  try {
    data = (await response.json()) as T | ApiErrorBody
  } catch {
    throw new Error('O servidor respondeu de forma inesperada.')
  }

  if (!response.ok) {
    const err = data as ApiErrorBody
    // Sessão morta: avisa o renderer pra voltar pro login. Só vale pra
    // rota autenticada — no /login um 401 seria credencial errada, mas
    // aquela rota é pública e nem chega aqui com 401.
    if (response.status === 401) notifySessionExpired()
    throw new ApiFieldError(
      err.error ?? 'Erro desconhecido ao falar com o servidor',
      err.field,
      err.status,
      err.code
    )
  }

  return data as T
}

// POST /users/:id/avatar — corpo binário cru (WebP já comprimido no
// cliente, ver UserProfileModal.tsx), Content-Type: image/webp. Caminho
// separado do apiRequest acima porque não é JSON.
//
// Também manda o avatar em GIF (2026-10-19): com `gifBytes`, vai pra
// /avatar/animated num corpo só — a cópia parada na frente, o GIF depois
// e o header dizendo onde uma acaba. Ver a rota no server.js.
async function uploadAvatarRequest(
  id: number,
  webpBytes: Uint8Array,
  gifBytes?: Uint8Array
): Promise<AuthUser> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/users/${id}/avatar${gifBytes ? '/animated' : ''}`, {
      method: 'POST',
      headers: {
        'Content-Type': gifBytes ? 'application/octet-stream' : 'image/webp',
        ...(gifBytes ? { 'X-Avatar-Static-Bytes': String(webpBytes.byteLength) } : {}),
        Authorization: authHeader()
      },
      // Node's fetch/BodyInit types (lib.dom vs @types/node) não batem
      // com Uint8Array direto — Buffer (subclasse de Uint8Array) resolve.
      body: gifBytes ? Buffer.concat([webpBytes, gifBytes]) : Buffer.from(webpBytes),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('O servidor demorou demais para responder. Tente novamente.')
    }
    throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.')
  }

  let data: AuthUser | ApiErrorBody
  try {
    data = (await response.json()) as AuthUser | ApiErrorBody
  } catch {
    throw new Error('O servidor respondeu de forma inesperada.')
  }

  if (!response.ok) {
    if (response.status === 401) notifySessionExpired()
    throw new Error('error' in data ? data.error : 'Erro desconhecido ao falar com o servidor')
  }

  return data as AuthUser
}

export function setupAuthHandlers(): void {
  // Cadastro e login guardam o JWT recebido: é ele que autentica TODO o
  // resto (salas, token do LiveKit, versão). Sem esse `setApiToken`, o
  // login "funcionaria" e o app ficaria tomando 401 em tudo depois.
  // ⚠️ O cadastro NÃO entra logado desde 2026-09-16 (migration 004 do
  // servidor): a conta nasce "pendente" e só um administrador libera.
  // Por isso a resposta não traz mais token, e não há o que guardar
  // aqui — `setApiToken` neste ponto guardaria `undefined` e derrubaria
  // a sessão de quem por acaso já estivesse logado.
  // Devolve um RESULTADO, e não só lança — pelo mesmo motivo do
  // `auth:login` logo abaixo: o Electron serializa apenas a `message` de
  // um erro que atravessa o IPC, e a tela precisa saber que a recusa foi
  // por FALTA DE VAGA pra mostrar a explicação certa em vez de um erro
  // de formulário.
  //
  // Os outros erros do cadastro (nome em uso, e-mail inválido) continuam
  // lançando: aqueles a tela já trata marcando o campo.
  ipcMain.handle('auth:register', async (_event, name: string, email: string, password: string) => {
    try {
      const result = await apiRequest<{ user: AuthUser; status: string }>('POST', '/register', {
        name,
        email,
        password
      })
      return { ok: true as const, user: result.user }
    } catch (err) {
      if (err instanceof ApiFieldError && err.code === 'user_limit_reached') {
        return { ok: false as const, reason: 'limitReached' as const, message: err.message }
      }
      throw err
    }
  })

  // Devolve um RESULTADO, e não só lança (2026-09-16).
  //
  // Um dos desfechos não é erro no sentido de "deu problema": a conta
  // pode estar BLOQUEADA. A tela precisa saber disso pra mostrar a
  // explicação certa, e um `throw` não carrega essa informação: o
  // Electron serializa apenas a `message` de um erro que atravessa o
  // IPC — qualquer campo extra se perde no caminho.
  //
  // Eram três situações até 2026-09-18 (pendente, recusada, bloqueada);
  // sobrou uma quando a aprovação manual deu lugar ao teto de contas.
  //
  // Credencial errada continua lançando: aquilo é erro mesmo, e a tela
  // já sabe mostrar a mensagem.
  ipcMain.handle('auth:login', async (_event, name: string, password: string) => {
    try {
      const result = await apiRequest<AuthResult>('POST', '/login', { name, password })
      setApiToken(result.token)
      return { ok: true as const, user: result.user }
    } catch (err) {
      if (err instanceof ApiFieldError && err.accountStatus) {
        return {
          ok: false as const,
          status: err.accountStatus,
          message: err.message
        }
      }
      throw err
    }
  })

  // Troca de senha (2026-09-10). Exige a senha atual mesmo já logado —
  // ver o comentário da rota no server.js.
  //
  // Desde a revogação por `token_version` (migration 003), trocar a
  // senha DERRUBA todas as sessões da conta — inclusive esta. Por isso a
  // rota devolve um token novo e ele é guardado aqui: sem isso, o
  // próximo request desta janela tomaria 401 e o app se deslogaria
  // sozinho logo depois de uma troca bem-sucedida. As OUTRAS sessões
  // (outra máquina, ou quem tivesse invadido a conta) caem no login, que
  // é justamente o objetivo.
  ipcMain.handle(
    'auth:changePassword',
    async (_event, id: number, currentPassword: string, newPassword: string) => {
      const result = await apiRequest<{ token: string }>('PUT', `/users/${id}/password`, {
        currentPassword,
        newPassword
      })
      setApiToken(result.token)
      // Regrava o session.json com o token novo. Sem isto, quem está com
      // "manter conectado" reabriria o app com o token revogado.
      persistSessionToken()
    }
  )

  // Recuperação de senha por e-mail (2026-09-10, item 16.4). As duas
  // rotas são PÚBLICAS — quem esqueceu a senha não tem token.
  ipcMain.handle('auth:requestPasswordReset', (_event, email: string) =>
    apiRequest<void>('POST', '/password-reset/request', { email })
  )

  ipcMain.handle(
    'auth:confirmPasswordReset',
    (_event, email: string, code: string, newPassword: string) =>
      apiRequest<void>('POST', '/password-reset/confirm', { email, code, newPassword })
  )

  // Troca de senha pela janela de PERFIL (2026-10-19, pedido do usuário):
  // mesmo caminho do "Esqueci minha senha" — código no e-mail da conta,
  // depois código + senha nova no /password-reset/confirm.
  //
  // O detalhe é que aquela rota DERRUBA todas as sessões da conta,
  // inclusive esta, e não devolve token (ver o comentário dela no
  // server.js). Pra quem está logado isso significaria ser jogado no
  // login logo depois de trocar a senha. Então, assim que a troca
  // confirma, entra de novo com a senha nova — que acabou de ser provada
  // — e guarda o token novo, igual o `auth:changePassword` faz.
  //
  // Os dois passos ficam juntos AQUI, e não em duas chamadas do
  // renderer: entre um e outro o token antigo já está revogado, e
  // qualquer request nesse intervalo tomaria 401 e deslogaria o app.
  // Aqui o intervalo é o tempo de um request.
  //
  // As outras sessões (outra máquina) continuam caindo — é o objetivo.
  ipcMain.handle(
    'auth:resetOwnPassword',
    async (_event, email: string, code: string, newPassword: string, name: string) => {
      await apiRequest<void>('POST', '/password-reset/confirm', { email, code, newPassword })
      try {
        const result = await apiRequest<AuthResult>('POST', '/login', {
          name,
          password: newPassword
        })
        setApiToken(result.token)
        persistSessionToken()
        return result.user
      } catch {
        // A senha JÁ mudou — só o login automático falhou. Mensagem
        // própria pra tela não dizer "não foi possível trocar a senha".
        throw new Error('PASSWORD_CHANGED_RELOGIN_FAILED')
      }
    }
  )

  ipcMain.handle('auth:rename', async (_event, id: number, name: string) => {
    const user = await apiRequest<AuthUser>('PUT', `/users/${id}`, { name })
    updateSessionUser(user)
    return user
  })

  // O handler `auth:setAvatarPreset` saiu em 2026-09-11 junto com os
  // presets de avatar: nenhuma tela chamava mais (a escolha manual de
  // cor tinha saído da UI no item 43) e ele era o último código vivo
  // que ainda MANDAVA um avatar 'preset' pro servidor.

  // Roadmap item 43: upload de foto customizada — `webpBytes` já chega
  // comprimido (canvas -> WebP 96x96, ver UserProfileModal.tsx), o main
  // só repassa pro token-server.
  ipcMain.handle('auth:uploadAvatar', async (_event, id: number, webpBytes: Uint8Array) => {
    const user = await uploadAvatarRequest(id, webpBytes)
    updateSessionUser(user)
    return user
  })

  // Avatar em GIF (2026-10-19): o GIF já recodificado no renderer e a
  // cópia parada em WebP — ver lib/avatarGif.ts lá.
  ipcMain.handle(
    'auth:uploadAnimatedAvatar',
    async (_event, id: number, webpBytes: Uint8Array, gifBytes: Uint8Array) => {
      const user = await uploadAvatarRequest(id, webpBytes, gifBytes)
      updateSessionUser(user)
      return user
    }
  )

  // Pedido do usuário (2026-09-06): grava as preferências da conta.
  // `patch` é PARCIAL (só as chaves que mudaram) — o server faz o merge
  // sobre o que já está salvo, então mandar uma chave nunca apaga as
  // outras. Passa pelo mesmo PUT /users/:id do nome/avatar, e atualiza
  // a sessão em disco pra a preferência sobreviver ao "manter conectado".
  ipcMain.handle(
    'auth:updateSettings',
    async (_event, id: number, patch: Partial<UserSettings>) => {
      const user = await apiRequest<AuthUser>('PUT', `/users/${id}`, { settings: patch })
      updateSessionUser(user)
      return user
    }
  )
}
