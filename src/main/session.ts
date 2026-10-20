import { app, ipcMain, safeStorage } from 'electron'
import { API_BASE_URL, CLIENT_HEADER, CLIENT_HEADER_VALUE } from './config'
import { authHeader, getApiToken, setApiToken } from './apiToken'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

// Mesma union de src/main/auth.ts (AvatarRef) — duplicada aqui de
// propósito, seguindo o padrão já existente no projeto de não
// compartilhar tipos pequenos entre main/preload/renderer (ver RoomInfo,
// duplicado em 3 lugares).
type AvatarRef =
  | { type: 'preset'; key: string }
  | { type: 'custom'; id: number; version: number; format?: 'webp' | 'gif' }

// Mesma duplicação deliberada do AvatarRef acima.
interface UserSettings {
  alertForNewLives: boolean
  // Sobreposição de viewers na tela durante a live (2026-09-10).
  // Nasce DESLIGADA: ela desenha por cima da tela do usuário.
  showViewersOverlay: boolean
}

export interface Session {
  id: number
  name: string
  // Gravado desde 2026-09-11 (o box de perfil exibe). Opcional pelo
  // mesmo motivo dos outros: sessão salva por uma versão anterior não
  // tem o campo e não pode quebrar por isso.
  email?: string
  avatar: AvatarRef | null
  // Gravado desde 2026-09-06 — sem isso, quem entra pelo "manter
  // conectado" começaria sem preferência nenhuma e o alerta de novas
  // lives voltaria ligado a cada abertura.
  settings?: UserSettings
  // BUG REAL corrigido em 2026-09-10: este campo NÃO era gravado, e o
  // preload/index.d.ts declarava que `session.load()` devolvia um
  // AuthUser completo — como os dois lados da fronteira de IPC são
  // declarações separadas, o TypeScript não pegava a mentira. Efeito
  // visível: reabrir com "manter conectado" mostrava o seletor de
  // status com NENHUMA opção marcada (ver UserProfileModal.tsx).
  presence?: 'available' | 'busy'
}

// O que fica GRAVADO em disco.
interface StoredSession extends Session {
  // Desde 2026-09-10: sem gravar o JWT, "manter conectado" abriria o app
  // sem token nenhum e tudo tomaria 401, porque esse fluxo não passa
  // pelo /login.
  //
  // CRIPTOGRAFADO desde 2026-09-10 (ver encryptToken abaixo) — em texto
  // puro, qualquer processo com acesso ao perfil do usuário levava um
  // bearer válido por 30 dias.
  token?: string
  // Marca se `token` está cifrado. Um session.json gravado por uma
  // versão anterior não tem o campo, e aí o token é lido como texto
  // puro — sem isso, atualizar o app deslogaria todo mundo.
  tokenEncrypted?: boolean
}

// "Manter conectado": guarda id/nome/avatar/settings/presença e o JWT
// num JSON em userData, pra pular a tela de login na próxima abertura.
// NUNCA guarda a senha — é por isso que o fluxo reusa o token em vez de
// "fazer login de novo": uma senha em disco vale pra sempre e em
// qualquer lugar, um JWT morre em 30 dias e só serve contra este
// servidor.
const SESSION_FILE = join(app.getPath('userData'), 'session.json')

// `safeStorage` usa a DPAPI no Windows: o texto cifrado só volta ao
// original na conta de usuário do Windows que cifrou, na mesma máquina.
// Copiar o session.json pra outro PC não adianta nada.
//
// `isEncryptionAvailable()` pode ser false (Linux sem chaveiro, alguns
// ambientes de CI). Nesse caso grava em texto puro e SEGUE — sem isso, o
// "manter conectado" simplesmente pararia de funcionar num ambiente que
// não é o do usuário final.
function encryptToken(token: string): { token: string; tokenEncrypted: boolean } {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('safeStorage indisponível — o token será gravado em texto puro.')
    return { token, tokenEncrypted: false }
  }
  return { token: safeStorage.encryptString(token).toString('base64'), tokenEncrypted: true }
}

function decryptToken(stored: StoredSession): string | null {
  if (!stored.token) return null
  // Sessão gravada antes de 2026-09-10, ou num ambiente sem cifragem.
  if (!stored.tokenEncrypted) return stored.token

  try {
    return safeStorage.decryptString(Buffer.from(stored.token, 'base64'))
  } catch (err) {
    // Perfil do Windows recriado, arquivo copiado de outra máquina,
    // chaveiro trocado. Tratado como "não há sessão": a pessoa faz login
    // de novo, que é bem melhor que um erro sem explicação.
    console.error('Não foi possível decifrar o token salvo, tratando como não logado:', err)
    return null
  }
}

function loadSession(): StoredSession | null {
  if (!existsSync(SESSION_FILE)) return null
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'))
  } catch (err) {
    console.error('Erro ao ler session.json, tratando como não logado:', err)
    return null
  }
}

function saveSession(session: Session, token: string | null): void {
  const dir = join(app.getPath('userData'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const stored: StoredSession = { ...session, ...(token ? encryptToken(token) : {}) }

  // Escreve num arquivo temporário e troca o nome depois (rename é
  // atômico no mesmo filesystem) — evita deixar o session.json pela
  // metade se o processo cair no meio da escrita.
  const tmpFile = `${SESSION_FILE}.tmp`
  writeFileSync(tmpFile, JSON.stringify(stored, null, 2))
  renameSync(tmpFile, SESSION_FILE)
}

function clearSession(): void {
  if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE)
}

// Chamado depois de renomear a conta ou trocar o avatar (ver
// src/main/auth.ts) — se o usuário tinha "Manter conectado" marcado, os
// dados salvos localmente não podem ficar desatualizados. No-op se não
// havia sessão salva.
export function updateSessionUser(user: {
  name: string
  avatar: AvatarRef | null
  settings?: UserSettings
  presence?: 'available' | 'busy'
  email?: string
}): void {
  const current = loadSession()
  if (!current) return
  saveSession(
    {
      ...current,
      name: user.name,
      avatar: user.avatar,
      // `?? current.x` preserva o que já estava salvo, em vez de zerar,
      // se alguma chamada chegar aqui sem o campo.
      settings: user.settings ?? current.settings,
      presence: user.presence ?? current.presence,
      email: user.email ?? current.email
    },
    getApiToken()
  )
}

// Regrava só o token (o resto da sessão fica como está). Chamado quando
// o servidor emite um token novo com a sessão já aberta: troca de senha
// (que revoga os anteriores) e a revalidação da abertura. Sem isso, o
// arquivo continuaria apontando pro token velho — que, no caso da troca
// de senha, acabou de ser revogado.
export function persistSessionToken(): void {
  const current = loadSession()
  if (!current) return
  saveSession(current, getApiToken())
}

// Três desfechos, e eles NÃO podem virar um `null` só: "o token morreu"
// e "não deu pra perguntar" levam a ações OPOSTAS — apagar a sessão ou
// seguir com ela.
type RevalidateResult =
  { status: 'ok'; user: Session } | { status: 'unauthorized' } | { status: 'offline' }

// Confere o token guardado com o servidor e traz o usuário FRESCO.
//
// É o que transforma "manter conectado" de "confia no arquivo local" em
// "confirma com quem sabe". Resolve três coisas de uma vez:
//
//   1. Token vencido/revogado é descoberto ANTES de a Home aparecer. Sem
//      isto, o app ia pra Home, o primeiro request tomava 401 e só então
//      voltava pro login — piscando uma tela já morta.
//   2. Nome, avatar, settings e presença chegam atualizados. O arquivo
//      guarda o que valia no último login; trocar o avatar em outra
//      máquina deixava esta exibindo o antigo.
//   3. O servidor devolve um token NOVO, então a sessão é deslizante:
//      quem abre o app dentro dos 30 dias ganha mais 30 e nunca é
//      deslogado. Quem some por mais de 30 dias cai no login.
//
// Custo percebido: zero. O splash já tem um piso de 1s (SPLASH_MIN_MS em
// App.tsx) e isto roda dentro dele.
async function revalidate(): Promise<RevalidateResult> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/me`, {
      headers: {
        Authorization: authHeader(),
        // Este é o caminho que a maioria dos acessos percorre: quem marca
        // "manter conectado" pode nunca mais passar pelo /login. Sem o
        // header AQUI, o painel registraria a versão só de quem digita a
        // senha — ou seja, quase ninguém.
        [CLIENT_HEADER]: CLIENT_HEADER_VALUE
      },
      signal: AbortSignal.timeout(10000)
    })
  } catch {
    // Servidor fora do ar ou sem rede. NÃO desloga: a sessão local pode
    // estar perfeitamente válida, e mandar a pessoa pro login — onde ela
    // também não conseguiria entrar, pela mesma falta de rede — trocaria
    // um problema por um pior. Segue com os dados do arquivo; se o token
    // estiver mesmo morto, o primeiro request autenticado descobre e o
    // 401 leva pro login.
    console.warn('Não foi possível revalidar a sessão (servidor inalcançável) — usando o cache.')
    return { status: 'offline' }
  }

  // Token vencido OU revogado (`token_version`, ex: a senha foi trocada
  // em outro lugar). Nos dois casos a sessão acabou.
  if (response.status === 401) return { status: 'unauthorized' }

  if (!response.ok) {
    // 500 e afins: problema do servidor, não da sessão. Mesmo
    // tratamento de estar offline.
    console.error(`GET /me respondeu ${response.status} — mantendo a sessão em cache.`)
    return { status: 'offline' }
  }

  try {
    const data = (await response.json()) as { user: Session; token: string }
    setApiToken(data.token)
    return { status: 'ok', user: data.user }
  } catch (err) {
    console.error('Resposta inesperada do GET /me:', err)
    return { status: 'offline' }
  }
}

export function setupSessionHandlers(): void {
  // Restaura o JWT no main ANTES de devolver a sessão, e devolve o
  // usuário SEM o token: o renderer não precisa dele pra nada (quem faz
  // request autenticado é o main) e não guardá-lo lá é uma superfície a
  // menos.
  ipcMain.handle('session:load', async () => {
    const stored = loadSession()
    if (!stored) return null

    const token = decryptToken(stored)
    setApiToken(token)

    // Sem token não há o que revalidar nem como usar o app — sessão de
    // uma versão antiga, ou arquivo corrompido.
    if (!token) {
      clearSession()
      return null
    }

    const result = await revalidate()

    if (result.status === 'unauthorized') {
      // Apaga tudo — deixar o arquivo faria a próxima abertura repetir a
      // mesma viagem pra chegar na mesma conclusão.
      setApiToken(null)
      clearSession()
      return null
    }

    if (result.status === 'ok') {
      // Regrava com os dados frescos E o token novo. É aqui que o
      // arquivo para de envelhecer.
      saveSession(result.user, getApiToken())
      return result.user
    }

    // Offline: segue com o que estava salvo. Note que o token continua
    // carregado no apiToken — a sessão não foi invalidada, só não deu
    // pra confirmar.
    return {
      id: stored.id,
      name: stored.name,
      avatar: stored.avatar,
      settings: stored.settings,
      presence: stored.presence,
      email: stored.email
    } satisfies Session
  })

  // O token vem do main, não do renderer — o renderer manda só os dados
  // do usuário.
  ipcMain.handle('session:save', (_event, session: Session) => saveSession(session, getApiToken()))

  ipcMain.handle('session:clear', () => {
    setApiToken(null)
    clearSession()
  })
}
