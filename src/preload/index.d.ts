import { ElectronAPI } from '@electron-toolkit/preload'

// Item 43 do roadmap: avatar de usuário. O braço `preset` é LEGADO
// (contas anteriores a 2026-09-11 ainda têm um gravado) — quem desenha
// só distingue "custom" de "qualquer outra coisa", ver UserAvatar.tsx.
type AvatarRef = { type: 'preset'; key: string } | { type: 'custom'; id: number; version: number }
type UserAvatars = Record<string, AvatarRef>

interface UserSettings {
  alertForNewLives: boolean
  // Sobreposição de viewers na tela durante a live (2026-09-10).
  // Nasce DESLIGADA: ela desenha por cima da tela do usuário.
  showViewersOverlay: boolean
}

interface AuthUser {
  id: number
  name: string
  // Só nas rotas do próprio usuário; o diretório (DirectoryUser) não tem.
  email: string
  avatar: AvatarRef | null
  settings: UserSettings
  // Preferencia de presenca (item 11). Duplicada aqui pelo mesmo motivo
  // do resto deste tipo: a fronteira de IPC nao importa do renderer.
  presence: 'available' | 'busy'
}

interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnailDataUrl: string
  displayId: number | null
}

interface NowPlayingInfo {
  // 'screen' = monitor inteiro sem jogo detectado; 'window' = janela
  // específica que não bateu com a lista do Discord. Os dois usam o
  // rótulo "Transmitindo:", mas placeholders diferentes (ver
  // gameDetection.ts no main).
  kind: 'game' | 'window' | 'screen'
  name: string
  // URL da arte do jogo no CDN do Discord — null/ausente pra janela,
  // monitor, ou jogo sem ícone na lista.
  iconUrl?: string | null
}

interface RoomInfo {
  name: string
  hostName: string | null
  participants: string[]
  game: NowPlayingInfo | null
  startedAt: number
  private: boolean
}

// userId -> estado. Ausente do mapa = offline.
type PresenceMap = Partial<Record<number, 'online' | 'busy'>>

interface DirectoryUser {
  id: number
  name: string
  avatar: AvatarRef | null
  settings: UserSettings
  presence: 'available' | 'busy'
}

interface RoomsSnapshot {
  rooms: RoomInfo[]
  userAvatars: UserAvatars
  presence: PresenceMap
}

interface UpdateInfo {
  version: string
  url: string
  sha256: string
}

// Mesmo resultado nos dois caminhos — o `check()` que o renderer pede no
// login e o push que o main manda quando uma versão é publicada. Ver
// UpdateCheckResult em src/main/update.ts.
type UpdateCheckResult =
  | { available: true; info: UpdateInfo; currentVersion: string }
  | { available: false; currentVersion: string }

interface GstreamerPipelineParams {
  // Guardado no main (não só no renderer) pra dar pra derrubar a
  // sala/ingress mesmo se o app for fechado de repente — ver
  // stopForAppQuit em src/main/gstreamerCapture.ts.
  roomCode: string
  whipUrl: string
  streamKey: string
  sourceId: string | null
  width: number
  height: number
  fps: number
  bitrateKbps: number
}

interface Api {
  // { user, token } desde 2026-09-10 — mas o `token` NÃO aparece aqui
  // de propósito: o main guarda ele e o renderer nunca precisa ver.
  auth: {
    // Sem `token` de propósito: cadastrar e entrar são dois passos, e a
    // tela de cadastro leva pro login com o usuário já preenchido.
    //
    // Dois desfechos (2026-09-18): criou, ou o servidor está SEM VAGAS —
    // e nesse caso a conta sequer chega a existir. Os outros erros (nome
    // em uso, e-mail inválido) continuam REJEITANDO a promise, porque a
    // tela os trata marcando o campo.
    register: (
      name: string,
      email: string,
      password: string
    ) => Promise<
      | { ok: true; user: AuthUser }
      | { ok: false; reason: 'limitReached'; message: string }
    >
    // Dois desfechos: entrou, ou a conta está bloqueada. Credencial
    // errada continua REJEITANDO a promise — ver src/main/auth.ts pro
    // porquê de a situação da conta não poder ser um erro lançado.
    login: (
      name: string,
      password: string
    ) => Promise<
      | { ok: true; user: AuthUser }
      | { ok: false; status: 'blocked'; message: string }
    >
    changePassword: (
      id: number,
      currentPassword: string,
      newPassword: string
    ) => Promise<void>
    // Recuperação de senha (2026-09-10). O `request` resolve sempre, o
    // e-mail existindo ou não — o servidor não revela isso de
    // propósito. O `confirm` rejeita com a mensagem do servidor quando
    // o código está errado ou expirado.
    requestPasswordReset: (email: string) => Promise<void>
    confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>
    onSessionExpired: (callback: () => void) => () => void
    rename: (id: number, name: string) => Promise<AuthUser>
    uploadAvatar: (id: number, webpBytes: Uint8Array) => Promise<AuthUser>
    updateSettings: (id: number, patch: Partial<UserSettings>) => Promise<AuthUser>
  }
  overlay: {
    update: (state: {
      visible: boolean
      viewers: { name: string; avatar: AvatarRef | null }[]
      apiBaseUrl: string
    }) => void
    resize: (height: number) => void
    onState: (
      callback: (state: {
        viewers: { name: string; avatar: AvatarRef | null }[]
        apiBaseUrl: string
      }) => void
    ) => () => void
  }
  users: {
    list: () => Promise<{ users: DirectoryUser[]; presence: PresenceMap }>
    // Devolve `AuthUser` e não `DirectoryUser`: a rota é `requireSelf`,
    // então o destinatário é o próprio dono e a resposta vem com e-mail
    // (privateUser, ver db/users.js no servidor). Quem NÃO é self — o
    // `list` acima — continua sem e-mail.
    setPresence: (id: number, preference: 'available' | 'busy') => Promise<AuthUser>
    invite: (roomName: string, userId: number) => Promise<void>
    acceptInvite: (roomName: string) => Promise<void>
    declineInvite: (roomName: string, reason: 'declined' | 'expired') => Promise<void>
    kick: (roomName: string, username: string) => Promise<void>
    onInvite: (
      callback: (invite: { roomName: string; hostName: string | null }) => void
    ) => () => void
    onInviteResult: (
      callback: (result: {
        roomName: string
        userId: number
        userName: string
        result: 'accepted' | 'declined' | 'expired'
      }) => void
    ) => () => void
  }
  session: {
    load: () => Promise<AuthUser | null>
    save: (session: AuthUser) => Promise<void>
    clear: () => Promise<void>
  }
  screenCapture: {
    listSources: () => Promise<CaptureSource[]>
  }
  livekit: {
    getToken: (params: {
      roomName: string
      participantName: string
      role: 'host' | 'viewer'
      hidden?: boolean
    }) => Promise<{ token: string; wsUrl: string }>
    // Devolve se derrubou de verdade (2026-08-31) — ver
    // src/main/livekit.ts pro porquê disso não ser mais só `Promise<void>`.
    deleteRoom: (roomName: string) => Promise<boolean>
    createIngress: (params: {
      roomName: string
      participantName: string
      private?: boolean
    }) => Promise<{ url: string; streamKey: string }>
    deleteIngress: (roomName: string) => Promise<boolean>
  }
  gstreamer: {
    start: (params: GstreamerPipelineParams) => Promise<{
      ok: boolean
      error?: string
    }>
    update: (params: GstreamerPipelineParams) => Promise<{
      ok: boolean
      error?: string
    }>
    stop: () => Promise<{ ok: boolean }>
    onExited: (callback: (info: { code: number | null; error?: string }) => void) => () => void
    // Item 13 do roadmap (troca automática de janela): o main mandou
    // trocar a janela capturada
    // sozinho (jogo do mesmo título abriu/fechou, ver
    // src/main/gameWindowFollow.ts). Quem ouve chama `update()` com esse
    // sourceId.
    onAutoSourceChanged: (callback: (info: { sourceId: string }) => void) => () => void
  }
  rooms: {
    list: () => Promise<RoomsSnapshot>
    refresh: () => Promise<RoomsSnapshot>
    // Nunca rejeita: servidor fora do ar não pode travar a entrada no app
    // (ver CONNECT_WAIT_TIMEOUT_MS em src/main/rooms.ts).
    connect: () => Promise<void>
    disconnect: () => Promise<void>
    onUpdate: (callback: (snapshot: RoomsSnapshot) => void) => () => void
  }
  update: {
    check: () => Promise<UpdateCheckResult>
    download: (info: UpdateInfo) => Promise<string>
    install: (installerPath: string) => Promise<void>
    // Aborta o download em andamento. Resolve mesmo se não houver nada
    // baixando.
    cancel: () => Promise<void>
    onDownloadProgress: (callback: (progress: number) => void) => () => void
    // Push do main: a disponibilidade mudou sem ninguém perguntar
    // (versão publicada no painel admin, anunciada pelo WebSocket —
    // ver src/main/rooms.ts).
    onAvailability: (callback: (result: UpdateCheckResult) => void) => () => void
  }
  // Mini player (2026-09-20) — ver src/main/popin.ts.
  popin: {
    dragStart: (cursorX: number, cursorY: number) => void
    dragMove: (cursorX: number, cursorY: number) => void
    dragEnd: () => void
    ready: () => void
    restoreApp: () => void
  }
  app: {
    onClosing: (callback: () => void) => () => void
    confirmQuit: () => void
    getVersion: () => Promise<string>
    getApiBaseUrl: () => Promise<string>
    // Aviso de convite na barra de tarefas (2026-09-13).
    setInviteFlash: (show: boolean) => void
    setTitleBarFocused: (focused: boolean) => void
  }
  games: {
    ensureDetectableList: () => Promise<{ downloaded: boolean; error?: boolean }>
    onListDownloadStart: (callback: () => void) => () => void
    onListDownloadProgress: (callback: (progress: number) => void) => () => void
    onListDownloadDone: (callback: () => void) => () => void
    onNowPlayingUpdate: (callback: (info: NowPlayingInfo | null) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
