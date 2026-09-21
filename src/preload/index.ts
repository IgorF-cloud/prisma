import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Resposta da checagem de atualização, nos DOIS caminhos: o `check()`
// que o renderer pede no login e o push que o main manda quando uma
// versão nova é publicada (ver src/main/update.ts).
type UpdateCheckResult =
  | {
      available: true
      info: { version: string; url: string; sha256: string }
      currentVersion: string
    }
  | { available: false; currentVersion: string }

interface RoomInfo {
  name: string
  hostName: string | null
  participants: string[]
  // Item 29 do roadmap: jogo (Steam ou lista do Discord) ou título da
  // janela sendo transmitida — null quando nada foi detectado/reportado.
  game: { kind: 'game' | 'window'; name: string } | null
  // Item 42 do roadmap: quando a sala começou de verdade (epoch ms, vem
  // do LiveKit via server.js) — timer de duração da live.
  startedAt: number
  // Item novo (2026-09-04, "sala com senha"): só a existência de uma
  // senha, NUNCA a senha em si (ver toPublicRoom em server.js).
  // Substituiu o `hasPassword` em 2026-09-10.
  private: boolean
}

// Item 43 do roadmap: avatar de usuário. O braço `preset` é LEGADO
// (contas anteriores a 2026-09-11 ainda têm um gravado) — quem desenha
// só distingue "custom" de "qualquer outra coisa", ver UserAvatar.tsx.
type AvatarRef = { type: 'preset'; key: string } | { type: 'custom'; id: number; version: number }
type UserAvatars = Record<string, AvatarRef>
interface RoomsSnapshot {
  rooms: RoomInfo[]
  userAvatars: UserAvatars
}

// Custom APIs for renderer
const api = {
  auth: {
    // `email` entrou em 2026-09-10 (obrigatório no cadastro). Cadastro e
    // login devolvem { user, token } — o token fica no main, o renderer
    // usa só o user.
    register: (name: string, email: string, password: string) =>
      ipcRenderer.invoke('auth:register', name, email, password),
    login: (name: string, password: string) => ipcRenderer.invoke('auth:login', name, password),
    changePassword: (id: number, currentPassword: string, newPassword: string) =>
      ipcRenderer.invoke('auth:changePassword', id, currentPassword, newPassword),
    // Recuperação de senha por e-mail (2026-09-10). Públicas: quem
    // esqueceu a senha não tem token.
    requestPasswordReset: (email: string) =>
      ipcRenderer.invoke('auth:requestPasswordReset', email),
    confirmPasswordReset: (email: string, code: string, newPassword: string) =>
      ipcRenderer.invoke('auth:confirmPasswordReset', email, code, newPassword),
    // O main avisa quando o JWT vence (401 em qualquer request) pro app
    // voltar à tela de login em vez de errar em silêncio.
    onSessionExpired: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('auth:session-expired', listener)
      return () => ipcRenderer.removeListener('auth:session-expired', listener)
    },
    rename: (id: number, name: string) => ipcRenderer.invoke('auth:rename', id, name),
    uploadAvatar: (id: number, webpBytes: Uint8Array) =>
      ipcRenderer.invoke('auth:uploadAvatar', id, webpBytes),
    // Preferências da conta (2026-09-06) — `patch` é parcial, o server
    // faz o merge sobre o que já está salvo (ver auth.ts no main).
    updateSettings: (id: number, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('auth:updateSettings', id, patch)
  },
  // Sobreposição de viewers na tela (2026-09-10). O renderer principal
  // MANDA o estado (`update`); a janela da overlay RECEBE (`onState`).
  overlay: {
    update: (state: { visible: boolean; viewers: unknown[]; apiBaseUrl: string }) =>
      ipcRenderer.send('overlay:update', state),
    resize: (height: number) => ipcRenderer.send('overlay:resize', height),
    onState: (callback: (state: { viewers: unknown[]; apiBaseUrl: string }) => void) => {
      const listener = (
        _e: unknown,
        state: { viewers: unknown[]; apiBaseUrl: string }
      ): void => callback(state)
      ipcRenderer.on('overlay:state', listener)
      return () => ipcRenderer.removeListener('overlay:state', listener)
    }
  },
  // Lista de usuarios, presenca e convites (2026-09-10).
  users: {
    list: () => ipcRenderer.invoke('users:list'),
    setPresence: (id: number, preference: 'available' | 'busy') =>
      ipcRenderer.invoke('users:setPresence', id, preference),
    invite: (roomName: string, userId: number) =>
      ipcRenderer.invoke('users:invite', roomName, userId),
    acceptInvite: (roomName: string) => ipcRenderer.invoke('users:acceptInvite', roomName),
    // Recusa (botão) ou expiração (timer de 30s do toast) — ver
    // src/main/users.ts.
    declineInvite: (roomName: string, reason: 'declined' | 'expired') =>
      ipcRenderer.invoke('users:declineInvite', roomName, reason),
    // Expulsar da minha live (2026-09-13). Ver src/main/users.ts pro
    // porquê de ser por nome.
    kick: (roomName: string, username: string) =>
      ipcRenderer.invoke('users:kick', roomName, username),
    // Convite CHEGANDO pelo WebSocket de salas (ver rooms.ts no main).
    onInvite: (callback: (invite: { roomName: string; hostName: string | null }) => void) => {
      const listener = (
        _e: unknown,
        invite: { roomName: string; hostName: string | null }
      ): void => callback(invite)
      ipcRenderer.on('rooms:invite', listener)
      return () => ipcRenderer.removeListener('rooms:invite', listener)
    },
    // O que aconteceu com um convite que EU mandei (2026-09-14).
    onInviteResult: (
      callback: (result: {
        roomName: string
        userId: number
        userName: string
        result: 'accepted' | 'declined' | 'expired'
      }) => void
    ) => {
      const listener = (
        _e: unknown,
        payload: {
          roomName: string
          userId: number
          userName: string
          result: 'accepted' | 'declined' | 'expired'
        }
      ): void => callback(payload)
      ipcRenderer.on('rooms:inviteResult', listener)
      return () => ipcRenderer.removeListener('rooms:inviteResult', listener)
    }
  },
  session: {
    load: () => ipcRenderer.invoke('session:load'),
    save: (session: { id: number; name: string; avatar: AvatarRef | null }) =>
      ipcRenderer.invoke('session:save', session),
    clear: () => ipcRenderer.invoke('session:clear')
  },
  screenCapture: {
    listSources: () => ipcRenderer.invoke('screenCapture:listSources')
  },
  livekit: {
    getToken: (params: {
      roomName: string
      participantName: string
      role: 'host' | 'viewer'
      hidden?: boolean
    }) => ipcRenderer.invoke('livekit:getToken', params),
    deleteRoom: (roomName: string) => ipcRenderer.invoke('livekit:deleteRoom', roomName),
    // `private` (2026-09-10): o switch "Transmissão privada" da tela de
    // iniciar live, no lugar da senha de sala que existia antes.
    createIngress: (params: { roomName: string; participantName: string; private?: boolean }) =>
      ipcRenderer.invoke('livekit:createIngress', params),
    deleteIngress: (roomName: string) => ipcRenderer.invoke('livekit:deleteIngress', roomName)
  },
  gstreamer: {
    start: (params: {
      roomCode: string
      whipUrl: string
      streamKey: string
      sourceId: string | null
      width: number
      height: number
      fps: number
      bitrateKbps: number
    }) => ipcRenderer.invoke('gstreamer:start', params),
    // Item 13 do roadmap: troca resolução/FPS/fonte de uma live já no ar
    // (mesmo whipUrl/streamKey do start original — não recria o
    // ingress/sala).
    update: (params: {
      roomCode: string
      whipUrl: string
      streamKey: string
      sourceId: string | null
      width: number
      height: number
      fps: number
      bitrateKbps: number
    }) => ipcRenderer.invoke('gstreamer:update', params),
    stop: () => ipcRenderer.invoke('gstreamer:stop'),
    onExited: (callback: (info: { code: number | null; error?: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        info: { code: number | null; error?: string }
      ): void => callback(info)
      ipcRenderer.on('gstreamer:exited', listener)
      return () => ipcRenderer.removeListener('gstreamer:exited', listener)
    },
    // Item 13 do roadmap, troca automática de janela (2026-09-10): o
    // main pede a troca de janela em
    // vez de reiniciar o pipeline sozinho, pra a troca passar pelo mesmo
    // `update()` de sempre — é ele que reaproveita o whipUrl/streamKey
    // (sem recriar a sala) e mantém o `settings.sourceId` do renderer em
    // dia, que é o que o modal de troca de fonte exibe.
    onAutoSourceChanged: (callback: (info: { sourceId: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: { sourceId: string }): void =>
        callback(info)
      ipcRenderer.on('gstreamer:autoSourceChanged', listener)
      return () => ipcRenderer.removeListener('gstreamer:autoSourceChanged', listener)
    }
  },
  rooms: {
    list: () => ipcRenderer.invoke('rooms:list'),
    // Item novo (2026-08-31): botão "atualizar lista" — pede a lista de
    // novo via HTTP, sem depender da saúde do WebSocket em tempo real
    // (ver src/main/rooms.ts).
    refresh: () => ipcRenderer.invoke('rooms:refresh'),
    // Abre o WebSocket de salas. Chamado DEPOIS do token existir — no fim
    // do login/cadastro e no splash do 'manter conectado'. Resolve quando
    // a conexão abre (ou estoura o teto), pra a tela segurar a navegação
    // e a Home já nascer com as salas.
    connect: () => ipcRenderer.invoke('rooms:connect'),
    disconnect: () => ipcRenderer.invoke('rooms:disconnect'),
    onUpdate: (callback: (snapshot: RoomsSnapshot) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: RoomsSnapshot): void =>
        callback(snapshot)
      ipcRenderer.on('rooms:update', listener)
      return () => ipcRenderer.removeListener('rooms:update', listener)
    }
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: (info: { version: string; url: string; sha256: string }) =>
      ipcRenderer.invoke('update:download', info),
    install: (installerPath: string) => ipcRenderer.invoke('update:install', installerPath),
    onDownloadProgress: (callback: (progress: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: number): void =>
        callback(progress)
      ipcRenderer.on('update:download-progress', listener)
      return () => ipcRenderer.removeListener('update:download-progress', listener)
    },
    // O main descobriu sozinho que a disponibilidade mudou — hoje só
    // quando o servidor anuncia uma publicação pelo WebSocket de salas
    // (2026-09-20, ver src/main/rooms.ts). Mesmo formato do `check()`,
    // porque é literalmente o resultado da mesma função.
    onAvailability: (callback: (result: UpdateCheckResult) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: UpdateCheckResult): void =>
        callback(result)
      ipcRenderer.on('update:availability', listener)
      return () => ipcRenderer.removeListener('update:availability', listener)
    }
  },
  // Mini player (2026-09-20). A JANELA em si nasce de um `window.open`
  // no renderer (ver src/main/popin.ts pro porquê) — o que passa por
  // aqui é só o que precisa do sistema: mover a janela acompanhando o
  // cursor e trazer o app de volta.
  popin: {
    // Arrastar: o renderer manda a posição do cursor, agrupada em um
    // envio por quadro (ver PopinPlayer.tsx); o main só aplica. As
    // coordenadas são as de tela do evento de ponteiro — começo e
    // movimento vêm sempre da mesma fonte, senão a janela salta no
    // primeiro quadro em tela com escala (ver popin.ts).
    dragStart: (cursorX: number, cursorY: number) =>
      ipcRenderer.send('popin:drag-start', cursorX, cursorY),
    dragMove: (cursorX: number, cursorY: number) =>
      ipcRenderer.send('popin:drag-move', cursorX, cursorY),
    dragEnd: () => ipcRenderer.send('popin:drag-end'),
    // 'já tenho imagem, pode mostrar a janela' — ela nasce escondida pra
    // não piscar preto antes do primeiro quadro (ver src/main/popin.ts).
    ready: () => ipcRenderer.send('popin:ready'),
    // Botão de expandir: a janela principal pode estar minimizada.
    restoreApp: () => ipcRenderer.send('popin:restore-app')
  },
  app: {
    // Main segurou o fechamento da janela (transmissão ativa, ver
    // index.ts) e está esperando o renderer parar tudo antes de
    // confirmar — ver App.tsx.
    onClosing: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('app:before-quit', listener)
      return () => ipcRenderer.removeListener('app:before-quit', listener)
    },
    confirmQuit: () => ipcRenderer.send('app:confirmed-quit'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    // Item 43 do roadmap: o renderer precisa disso pra montar a URL de um
    // avatar customizado (<img src="{apiBaseUrl}/avatars/<id>.webp?v=...">).
    getApiBaseUrl: () => ipcRenderer.invoke('app:getApiBaseUrl'),
    // Pedido do usuário (2026-09-03): "Modo foco" (item 32) troca a
    // titleBarOverlay de transparente pra opaca (cor de fundo da Home)
    // — ver HomeScreen.tsx/main/index.ts.
    // Aviso de convite na barra de tarefas (2026-09-13): o botão do app
    // pisca no laranja do Windows. Ver src/main/taskbarFlash.ts.
    setInviteFlash: (show: boolean) => ipcRenderer.send('app:setInviteFlash', show),
    setTitleBarFocused: (focused: boolean) => ipcRenderer.send('app:setTitleBarFocused', focused)
  },
  games: {
    // Item 29 do roadmap: garante que a lista de jogos detectáveis (cache
    // do token-server, ver gameDetectableCache.ts) está atualizada no
    // disco local — só baixa de novo (disparando os eventos de progresso
    // abaixo) se o cache já passou de alguns dias ou nunca existiu.
    ensureDetectableList: () => ipcRenderer.invoke('games:ensureDetectableList'),
    onListDownloadStart: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('games:list-download-start', listener)
      return () => ipcRenderer.removeListener('games:list-download-start', listener)
    },
    onListDownloadProgress: (callback: (progress: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: number): void =>
        callback(progress)
      ipcRenderer.on('games:list-download-progress', listener)
      return () => ipcRenderer.removeListener('games:list-download-progress', listener)
    },
    onListDownloadDone: (callback: () => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('games:list-download-done', listener)
      return () => ipcRenderer.removeListener('games:list-download-done', listener)
    },
    // Jogo/janela detectado na transmissão ATUAL do próprio host — não dá
    // pra descobrir isso pela lista de salas (a própria live nunca aparece
    // nela pro host, ver ROADMAP.md item 18), por isso esse canal à parte.
    onNowPlayingUpdate: (
      callback: (info: { kind: 'game' | 'window'; name: string } | null) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        info: { kind: 'game' | 'window'; name: string } | null
      ): void => callback(info)
      ipcRenderer.on('games:nowPlayingUpdate', listener)
      return () => ipcRenderer.removeListener('games:nowPlayingUpdate', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
