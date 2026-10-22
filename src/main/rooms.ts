import { BrowserWindow, ipcMain } from 'electron'
import WebSocket from 'ws'
import { API_BASE_URL } from './config'
import { authHeader } from './apiToken'
import { logEvent } from './debugLog'
import { notifyUpdateAvailability } from './update'
import { NowPlaying, resendNowPlayingAfterReconnect } from './gameDetection'
import { ChatMessage } from './chat'

// Roadmap item 43 — mesma union de src/main/auth.ts, duplicada aqui
// seguindo o padrão já existente no projeto (ver RoomInfo, já duplicado
// em rooms.ts/preload/index.ts/index.d.ts).
export type AvatarRef =
  { type: 'preset'; key: string } | { type: 'custom'; id: number; version: number }

// Diretório nome -> avatar (item 43), recalculado do zero pelo
// token-server a cada broadcast (ver buildUserAvatarsDirectory em
// server.js) — vem junto de toda mensagem 'rooms' (WS) e de GET /rooms,
// nunca por sala (avatares não são um dado da sala, são do usuário).
export type UserAvatars = Record<string, AvatarRef>

// userId -> estado. Só quem está CONECTADO aparece aqui; ausente do
// mapa = offline. Vem junto de todo broadcast de salas (2026-09-10),
// no mesmo canal, porque presença muda pelos mesmos eventos.
export type PresenceMap = Partial<Record<number, 'online' | 'busy'>>

export interface RoomsSnapshot {
  rooms: RoomInfo[]
  userAvatars: UserAvatars
  presence: PresenceMap
}

export interface RoomInfo {
  name: string
  hostName: string | null
  // Quem está na sala agora (inclui o host) — a quantidade de espectadores
  // é derivada disso (participants.length descontando o host), não de um
  // "numParticipants" separado: o campo que o LiveKit manda no webhook não
  // ficava em sincronia com o participante do evento (contador zerado ao
  // entrar, só "alcançava" depois de outro evento) — contar essa lista, que
  // o token-server mantém a partir da identity de cada evento, é sempre
  // consistente.
  participants: string[]
  // Item 29 do roadmap: jogo (Steam/lista do Discord) ou título da janela
  // sendo transmitida — null quando nada foi detectado/reportado ainda.
  //
  // IMPORTADO de gameDetection.ts desde 2026-09-24, em vez de redeclarado
  // aqui: a cópia local tinha ficado pra trás em 'screen' e `iconUrl` (os
  // dois de 2026-09-05), então este tipo mentia sobre o que passa pelo
  // IPC. É o mesmo processo, não há fronteira nenhuma pra justificar a
  // duplicata — ao contrário do preload, ver nowPlaying.ts no renderer.
  game: NowPlaying | null
  // Item 42 do roadmap: quando a sala começou de verdade (epoch ms) — vem
  // do `creationTimeMs` do próprio LiveKit (ver server.js), não do
  // relógio de nenhuma máquina cliente. Usado pro timer de duração da
  // live (host, no footer; viewers, no tile da sala).
  startedAt: number
  // Item novo (2026-09-04, "sala com senha"): só a existência de uma
  // senha, NUNCA a senha em si (ver toPublicRoom em server.js).
  private: boolean
}

// Item 19 do roadmap: lista de salas em tempo real. Um WebSocket nativo do
// browser não consegue mandar o header Authorization no handshake — por
// isso essa conexão é feita aqui no main (que já tem o TOKEN_API_SECRET,
// nunca exposto pro renderer) e repassada pro renderer via IPC, mesmo
// padrão de segurança do resto do app (auth, livekit).
let latestRooms: RoomInfo[] = []
let latestUserAvatars: UserAvatars = {}
// Vazio ate o primeiro broadcast chegar. Vazio = todo mundo offline, que
// e a leitura certa antes de o socket conectar.
let latestPresence: PresenceMap = {}
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let currentSocket: WebSocket | null = null

// A conexão é AUTORIZADA? (2026-09-13)
//
// Antes o `connect()` era chamado no boot do app, dentro do
// `setupRoomsHandlers`. Só que naquele momento não existe token: o
// `authHeader()` devolve "Bearer " vazio, o servidor fecha o socket
// com 4401 e o handler de `close` reagenda em 3s — um ciclo de
// tentativas fracassadas rodando durante toda a tela de login.
//
// Pior que o barulho no log: depois do login NADA reconectava. O
// WebSocket só passava a funcionar quando calhava de um retry do ciclo
// de 3s cair depois do token existir — e esse resto de timer era o
// atraso de ~1s que o usuário via pras salas aparecerem na Home.
//
// Agora quem manda conectar é o renderer, depois de ter o token na
// mão: no fim do login/cadastro e no splash do "manter conectado".
let connectionAllowed = false

// Quem está esperando a conexão abrir (o `rooms:connect` devolve uma
// promise). Uma LISTA porque chamadas simultâneas são possíveis, e
// todas devem resolver no mesmo evento.
let openWaiters: (() => void)[] = []

// Teto pra espera do renderer. Servidor fora do ar não pode prender a
// pessoa num splash eterno: passado esse tempo o app segue pra Home e
// o ciclo de reconexão continua sozinho, em segundo plano.
const CONNECT_WAIT_TIMEOUT_MS = 4000

function resolveOpenWaiters(): void {
  const waiters = openWaiters
  openWaiters = []
  for (const resolve of waiters) resolve()
}

// Bug real reportado (2026-08-31): às vezes o app parava de receber
// atualização de salas sem o WebSocket nunca disparar 'close' — uma
// conexão TCP pode morrer "na marra" (rede instável, NAT/firewall
// derrubando conexão ociosa no meio do caminho) sem RST/FIN nenhum
// chegando, então nem cliente nem servidor percebem sozinhos. Servidor
// já ganhou ping/pong (ver server.js) que derruba a conexão morta DO
// LADO DELE; esse watchdog aqui é o espelho do lado do cliente — some
// contando desde a última atividade (mensagem OU ping recebido; a lib
// `ws` responde pong sozinha, sem precisar de código nenhum aqui, mas
// dispara o evento 'ping' antes de responder, o que já basta pra saber
// que a conexão está viva). Se passar tempo demais sem nada, força o
// reconnect em vez de esperar um 'close' que pode nunca vir.
const STALE_TIMEOUT_MS = 60000
const STALE_CHECK_INTERVAL_MS = 15000
let lastActivityAt = Date.now()
let staleCheckTimer: ReturnType<typeof setInterval> | null = null

function wsUrl(): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/ws/rooms`
}

function markActivity(): void {
  lastActivityAt = Date.now()
}

function connect(mainWindow: BrowserWindow): void {
  // Chamado pelo timer de reconexão também — sem esta guarda, um
  // `disconnect()` (logout) seria desfeito pelo retry já agendado.
  if (!connectionAllowed) {
    logEvent('rooms', 'conexão não autorizada (sem login) — ignorando')
    return
  }
  logEvent('rooms', `conectando em ${wsUrl()}`)
  markActivity()
  const socket = new WebSocket(wsUrl(), {
    headers: { Authorization: authHeader() }
  })
  currentSocket = socket

  socket.on('open', () => {
    logEvent('rooms', 'WebSocket aberto')
    markActivity()
    // Libera quem chamou `rooms:connect` e está segurando a navegação
    // pra Home.
    resolveOpenWaiters()
    // E, se eu estiver transmitindo, reenvia o jogo/janela pra sala
    // (2026-09-21). Esta conexão cair e voltar é o sinal mais próximo que
    // o app tem de "o servidor reiniciou" — e um servidor que reiniciou
    // pode não saber mais o que eu estou transmitindo. Não faz nada
    // quando não há transmissão, que é o caso deste `open` no login. Ver
    // gameDetection.ts.
    resendNowPlayingAfterReconnect()
  })

  socket.on('ping', () => markActivity())

  socket.on('message', (data) => {
    markActivity()
    try {
      const parsed = JSON.parse(data.toString()) as {
        type: string
        rooms: RoomInfo[]
        userAvatars?: UserAvatars
        presence?: PresenceMap
        // Só nas mensagens type: "chat" / "chatMuted" (ver abaixo).
        roomName?: string
        // Só na mensagem type: "friends" (ver abaixo).
        friends?: number[]
        incoming?: number[]
        outgoing?: number[]
        // Só na mensagem type: "version" (ver abaixo).
        version?: string
        // Só na mensagem type: "chat" / "chatMuted" (ver abaixo).
        message?: ChatMessage
        // Quem foi silenciado/liberado.
        username?: string
        muted?: boolean
      }

      // Uma versão nova do app foi publicada no painel admin
      // (2026-09-20). Chega por este socket porque ele já existe, já é
      // autenticado e já está aberto durante a sessão inteira — abrir
      // outro canal ou ficar perguntando de tempos em tempos seria
      // construir um caminho novo pra uma informação que o servidor já
      // sabe empurrar.
      //
      // A mensagem é só um AVISO: quem responde "e isso é mais novo que
      // a minha versão?" é o `GET /version` de sempre, pela mesma função
      // que o login usa (ver update.ts). Assim o botão de atualizar
      // nunca aparece por um critério diferente do diálogo.
      if (parsed.type === 'version') {
        logEvent('rooms', `servidor anunciou a versão ${parsed.version ?? '?'}`)
        void notifyUpdateAvailability(mainWindow)
        return
      }

      // Chat temporário da live (2026-09-23). Desce por este mesmo
      // socket, e não por data channel do LiveKit, porque o HOST não tem
      // conexão nenhuma com a sala — quem publica por ele é o Ingress
      // (GStreamer/WHIP), que só carrega mídia. Ver src/main/chat.ts.
      //
      // Repassado inteiro pro renderer; não mexe em estado de sala
      // nenhum. O próprio autor também recebe a dele (o servidor ecoa de
      // propósito), então o app nunca precisa de update otimista.
      if (parsed.type === 'chat') {
        if (!mainWindow.isDestroyed() && parsed.message) {
          mainWindow.webContents.send('rooms:chat', {
            roomName: parsed.roomName ?? '',
            message: parsed.message
          })
        }
        return
      }

      // O host me silenciou (ou me liberou) numa live. Serve pro app
      // desabilitar o campo de texto em vez de deixar escrever e tomar
      // 403 no envio.
      if (parsed.type === 'chatMuted') {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rooms:chatMuted', {
            roomName: parsed.roomName ?? '',
            username: parsed.username ?? '',
            muted: parsed.muted === true
          })
        }
        return
      }

      // Amizades (2026-10-21): o RETRATO completo das minhas relações —
      // amigos, pedidos recebidos e enviados —, que o servidor manda no
      // connect e a cada mudança dos dois lados. Repassado inteiro: quem
      // guarda o estado é o renderer (useFriends).
      if (parsed.type === 'friends') {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rooms:friends', {
            friends: parsed.friends ?? [],
            incoming: parsed.incoming ?? [],
            outgoing: parsed.outgoing ?? []
          })
        }
        return
      }

      if (parsed.type === 'rooms') {
        latestRooms = parsed.rooms
        latestUserAvatars = parsed.userAvatars ?? {}
        latestPresence = parsed.presence ?? {}
        logEvent(
          'rooms',
          `mensagem 'rooms' recebida: ${parsed.rooms.length} sala(s) — ` +
            parsed.rooms.map((r) => `${r.name} (host=${r.hostName ?? '?'})`).join(', ')
        )
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rooms:update', {
            rooms: latestRooms,
            userAvatars: latestUserAvatars,
            presence: latestPresence
          })
        }
      }
    } catch (err) {
      logEvent('rooms', `erro processando mensagem: ${err}`)
    }
  })

  socket.on('error', (err) => {
    logEvent('rooms', `erro na conexão: ${err}`)
  })

  // Reconecta sozinho se a conexão cair (token-server reiniciado, rede
  // instável, etc.) — sem isso a lista de salas fica presa no último
  // estado conhecido pra sempre.
  socket.on('close', (code, reason) => {
    if (currentSocket === socket) currentSocket = null
    if (mainWindow.isDestroyed()) return

    if (!connectionAllowed) {
      logEvent('rooms', `WebSocket fechado (code=${code}) — sem login, não reconecta`)
      return
    }

    logEvent('rooms', `WebSocket fechado (code=${code}, reason=${reason}) — reconectando em 3s`)
    reconnectTimer = setTimeout(() => connect(mainWindow), 3000)
  })
}

function startStaleWatchdog(mainWindow: BrowserWindow): void {
  staleCheckTimer = setInterval(() => {
    if (!currentSocket) return
    const idleFor = Date.now() - lastActivityAt
    if (idleFor < STALE_TIMEOUT_MS) return
    logEvent(
      'rooms',
      `nenhuma atividade há ${Math.round(idleFor / 1000)}s — conexão provavelmente morta, forçando reconexão`
    )
    // `terminate()` (não `close()`) — a conexão já não responde de
    // verdade, um close educado (handshake) esperaria uma resposta que
    // nunca vem. Isso já dispara o 'close' acima, que agenda o
    // reconnect sozinho.
    currentSocket.terminate()
  }, STALE_CHECK_INTERVAL_MS)

  mainWindow.on('closed', () => {
    if (staleCheckTimer) clearInterval(staleCheckTimer)
  })
}

// Item novo (2026-08-31, pedido do usuário): botão "atualizar lista de
// salas" na Home — de propósito um caminho HTTP totalmente separado do
// WebSocket (GET /rooms, ver server.js), não só reempurrar o
// `latestRooms` já em cache. Se o WebSocket estiver "zumbi" (o próprio
// bug que motivou o watchdog acima), pedir a lista de novo por ele não
// ajudaria em nada — esse caminho funciona mesmo com o WS morto.
async function refreshFromServer(mainWindow: BrowserWindow): Promise<RoomsSnapshot> {
  const response = await fetch(`${API_BASE_URL}/rooms`, {
    headers: { Authorization: authHeader() }
  })
  if (!response.ok) {
    throw new Error(`GET /rooms devolveu HTTP ${response.status}`)
  }
  const data = (await response.json()) as {
    rooms: RoomInfo[]
    userAvatars?: UserAvatars
    presence?: PresenceMap
  }
  latestRooms = data.rooms
  latestUserAvatars = data.userAvatars ?? {}
  latestPresence = data.presence ?? {}
  logEvent('rooms', `refresh manual: ${data.rooms.length} sala(s)`)
  const snapshot = { rooms: latestRooms, userAvatars: latestUserAvatars, presence: latestPresence }
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('rooms:update', snapshot)
  }
  return snapshot
}

export function setupRoomsHandlers(mainWindow: BrowserWindow): void {
  // NÃO conecta aqui (2026-09-13) — ver `connectionAllowed` lá em cima.
  // O watchdog pode subir junto: ele só age quando existe um socket.
  startStaleWatchdog(mainWindow)

  // Abre a conexão e RESOLVE quando ela estiver de pé. É o que deixa a
  // tela de login (e o splash) segurarem a navegação até as salas já
  // estarem carregadas — em vez de a Home aparecer vazia e preencher
  // sozinha um segundo depois.
  //
  // Nunca rejeita: servidor fora do ar não deve travar a entrada no
  // app. Estoura o teto, segue pra Home, e a reconexão continua por
  // conta própria.
  ipcMain.handle('rooms:connect', () => {
    connectionAllowed = true

    // Já conectado (ex: trocou de conta sem fechar o app): nada a
    // esperar.
    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        resolve()
      }

      openWaiters.push(finish)
      setTimeout(() => {
        if (done) return
        logEvent(
          'rooms',
          `conexão não abriu em ${CONNECT_WAIT_TIMEOUT_MS}ms — seguindo mesmo assim`
        )
        finish()
      }, CONNECT_WAIT_TIMEOUT_MS)

      // Só dispara se não houver uma tentativa em andamento — senão
      // dois sockets concorrentes.
      if (!currentSocket) connect(mainWindow)
    })
  })

  // Logout: para de tentar. Sem isto o ciclo de 3s continuaria batendo
  // com um token que acabou de ser apagado, enchendo o log de 4401 —
  // exatamente o que acontecia antes do login.
  ipcMain.handle('rooms:disconnect', () => {
    connectionAllowed = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    currentSocket?.close()
    currentSocket = null
    // O cache também some: são as salas visíveis pra conta que saiu, e
    // a próxima a entrar não pode herdar isso nem por um instante.
    latestRooms = []
    latestUserAvatars = {}
    latestPresence = {}
    resolveOpenWaiters()
    logEvent('rooms', 'desconectado (logout)')
  })

  mainWindow.on('closed', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
  })

  // Snapshot já conhecido, pro renderer ter algo pra mostrar assim que
  // monta (sem esperar o próximo evento do WebSocket).
  ipcMain.handle('rooms:list', () => ({
    rooms: latestRooms,
    userAvatars: latestUserAvatars,
    presence: latestPresence
  }))
  ipcMain.handle('rooms:refresh', () => refreshFromServer(mainWindow))
}
