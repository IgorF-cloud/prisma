import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  MessageSquare,
  MessageSquareOff,
  Monitor,
  SlidersHorizontal,
  Square,
  Tv,
  UserMinus
} from 'lucide-react'
import { TransmissionSettings } from '../lib/transmissionSettings'
import { PresenceMap, RoomFeed, RoomInfo, roomSources } from '../lib/useRooms'
import { NowPlayingInfo } from '../lib/nowPlaying'
import { AuthUser, newLiveAlertsOf } from '../lib/authUser'
import { HiddenFeeds, ViewerAudioState } from '../lib/useViewer'
import { WebcamStatus } from '../lib/useWebcamTransmission'
import { currentHostRoom } from '../lib/hostRoom'
import { ChatRoomState } from '../lib/useLiveChat'
import { RawTrackStats } from '../lib/useTrackStats'
import SourcePickerDialog from '../components/SourcePickerDialog'
import SettingsModal from '../components/SettingsModal'
import ProfileWindow from '../components/ProfileWindow'
import HostPreviewTile from '../components/HostPreviewTile'
import ViewerTile from '../components/ViewerTile'
import LiveTimer from '../components/LiveTimer'
import AppLeftSidebar from '../components/AppLeftSidebar'
import RoomDetailsSidebar from '../components/RoomDetailsSidebar'
import ViewerCamTile from '../components/ViewerCamTile'
import WebcamLiveCard from '../components/WebcamLiveCard'
import AddTransmissionTile from '../components/AddTransmissionTile'
import LiveChat from '../components/LiveChat'
import ViewerAvatarRow from '../components/ViewerAvatarRow'
import FriendsSidebar from '../components/FriendsSidebar'
import MembersPanel from '../components/MembersPanel'
import { FriendsContext, FriendsContextValue } from '../lib/friendActions'
import Tooltip from '../components/Tooltip'
import NowPlayingArt from '../components/NowPlayingArt'
import MarqueeText from '../components/MarqueeText'
import { AvatarRef } from '../lib/avatar'
import { useRoomPresenceSounds } from '../lib/useRoomPresenceSounds'
import { useNewLiveAlerts } from '../lib/useNewLiveAlerts'
import NewLiveAlertStack from '../components/NewLiveAlertStack'
import { useUsersDirectory } from '../lib/useUsersDirectory'
import { useFriends } from '../lib/useFriends'
import { getErrorMessage } from '../lib/errors'
import UserCardPopover, { UserCardStatus, UserCardTarget } from '../components/UserCardPopover'
import ContextMenu, { ContextMenuPosition } from '../components/ContextMenu'

interface HomeScreenProps {
  user: AuthUser
  appVersion: string
  onLogout: () => void
  onUserUpdate: (user: AuthUser) => void
  rooms: RoomInfo[]
  // Item 43 do roadmap: diretório nome -> avatar, atualizado em tempo
  // real junto de `rooms` (ver useRooms.ts/server.js) — usado pra
  // mostrar o avatar do host no tile da sala e de cada viewer nas listas
  // de quem está assistindo.
  userAvatars: Record<string, AvatarRef>
  // Item 11: quem está online agora. Vem no mesmo broadcast das salas.
  presence: PresenceMap
  // Item 43 do roadmap: só o main process conhece a URL do token-server —
  // precisa disso pra montar a URL de uma foto de avatar customizada.
  apiBaseUrl: string
  // Item 38 do roadmap: código da MINHA sala a esconder da lista — só
  // solta quando a sala some de vez de `rooms` em tempo real (ver
  // useHiddenOwnRoomCode.ts), não assim que a transmissão local termina.
  hiddenOwnRoomCode: string | null
  // Item novo (2026-08-31): botão "atualizar lista de salas" — pede a
  // lista de novo por um caminho HTTP separado do WebSocket em tempo
  // real (ver useRooms.ts/rooms.ts), pra funcionar mesmo se a conexão
  // em tempo real estiver com problema.
  refreshingRooms: boolean
  onRefreshRooms: () => void
  // Item 23 do roadmap: uma conexão independente por sala assistida —
  // todas simultâneas, não só uma.
  viewerRoomCodes: string[]
  // Mini player (2026-09-20): a live que está na janelinha sai da grade,
  // mas continua conectada — quem some é só o tile. null quando não há
  // nenhuma lá.
  popinRoomCode: string | null
  onPopinRoom: (code: string) => void
  // Item novo (2026-09-04, "sala com senha"): `password` só é passada
  // quando a sala pede uma (ver RoomInfo.hasPassword) — devolve `error`
  // com o motivo específico (ex: "Senha incorreta.") pro modal de senha
  // poder mostrar inline, além do snackbar genérico de sempre.
  // `hidden` (2026-10-20): entrar já com uma das transmissões fechada —
  // o "Assistir" de UMA delas na ficha da sala.
  onJoinRoom: (
    code: string,
    password?: string,
    hidden?: RoomFeed[]
  ) => Promise<{ ok: boolean; error?: string }>
  onLeaveRoom: (code: string) => void
  getAttachViewerVideo: (code: string) => (element: HTMLVideoElement | null) => void
  getAttachViewerAudioContainer: (code: string) => (element: HTMLDivElement | null) => void
  // Volume/mute por live assistida — nunca se aplica ao preview do host
  // (esse já é <video muted> direto).
  viewerAudioSettings: Record<string, ViewerAudioState>
  onSetViewerVolume: (code: string, volume: number) => void
  onSetViewerMuted: (code: string, muted: boolean) => void
  // Item 26 do roadmap: estatísticas em tempo real — só nas lives
  // assistidas por enquanto (a versão do lado do host, via GStreamer,
  // ainda não foi reimplementada — ver ROADMAP.md).
  getViewerStatsFetcher: (code: string) => () => Promise<RawTrackStats | undefined>
  getViewerBitrateFetcher: (code: string) => () => number
  // Webcam de quem transmite (2026-10-20, item 26): o <video> do tile
  // dela e o fechar/reabrir de cada transmissão da sala — ver useViewer.ts.
  getAttachViewerCamVideo: (code: string) => (element: HTMLVideoElement | null) => void
  viewerHiddenFeeds: HiddenFeeds
  onSetViewerFeedVisible: (code: string, feed: RoomFeed, visible: boolean) => void
  // O SELETOR DE FONTE ÚNICO (2026-10-22, montado pelo App): sem argumento,
  // com a chave "Tela | Vídeo" (o botão da barra); com um, exclusivo naquela
  // (o "Adicionar transmissão de …" do rodapé).
  onOpenPicker: (only?: 'screen' | 'cam') => void
  // A webcam (2026-10-20, item 26): o estado dela e o parar.
  webcamStatus: WebcamStatus
  onStopWebcam: () => void
  transmitting: boolean
  // Entre o clique em "Compartilhar tela" e o pipeline rodando
  // (2026-10-16). A ficha da live já aparece; só o selo diz "iniciando".
  launchingTransmission: boolean
  // Pedido do usuário (2026-08-31): entre clicar em "Parar" e a sala ser
  // confirmada derrubada de verdade (ver useGstreamerTransmission.ts,
  // que insiste até confirmar) — footer mostra "Parando transmissão..."
  // em vez dos controles normais nesse meio tempo.
  stoppingTransmission: boolean
  roomCode: string | null
  // O cartão da webcam no rodapé (2026-10-20, item 26, etapa 4): o nome
  // da câmera, desde quando ela conta e a miniatura ao vivo.
  webcamDeviceName: string | null
  webcamStartedAt: number | null
  attachWebcamPreviewVideo: (element: HTMLVideoElement | null) => void
  // Quando o APP começou a contar esta live (epoch ms), marcado no
  // clique em "Compartilhar tela" (2026-10-16). Relógio provisório: o
  // oficial é o `startedAt` que o LiveKit grava na sala e que chega pela
  // lista alguns instantes depois. Ver `startedAt` em
  // useGstreamerTransmission.ts.
  transmissionStartedAt: number | null
  // Item 29 do roadmap: jogo (Steam/lista do Discord) ou título da janela
  // sendo transmitida agora, detectado pelo main — null enquanto nada foi
  // identificado ainda.
  nowPlaying: NowPlayingInfo | null
  transmissionSettings: TransmissionSettings | null
  // Mensagem no snackbar (quem renderiza ele é o App, pra sobreviver a
  // troca de tela). Usado pelo retorno de convite enviado/falhou e
  // pelo upload de foto de perfil.
  //
  // `durationMs: 0` deixa a mensagem FIXA até alguém trocá-la — é
  // como o upload avisa que está em andamento sem sumir no meio (ver
  // useSnackbar.ts).
  onNotify: (message: string, isError?: boolean, options?: { durationMs?: number }) => void
  // Item 21 do roadmap: chat temporário da live (2026-09-23).
  //
  // `chatRooms` vem inteiro, e não só o da minha sala, porque a ficha
  // de uma sala ASSISTIDA (RoomDetailsSidebar) também tem chat — são
  // duas telas lendo do mesmo mapa. Sala sem chat aberto simplesmente
  // não está no mapa.
  chatRooms: Record<string, ChatRoomState>
  onSendChat: (roomCode: string, text: string) => Promise<boolean>
  onChatRead: (roomCode: string) => void
  // Silenciar no chat: só vale na MINHA live, e o servidor recusa com
  // 403 quem não for o host — o botão sumir da UI é conveniência, não a
  // trava.
  onSetChatMuted: (roomCode: string, username: string, muted: boolean) => void
  onStopTransmission: () => Promise<void>
  // Item 13 do roadmap: troca resolução/FPS/fonte sem derrubar a sala —
  // mata e sobe de novo o processo GStreamer com os parâmetros novos
  // (ver nota em gstreamerCapture.ts sobre a reconexão rápida que isso
  // causa do lado de quem assiste).
  onUpdateTransmission: (settings: TransmissionSettings) => Promise<boolean>
  // Item 15 do roadmap: preview da própria live pro host — ver
  // useHostPreview.ts pro porquê disso ser uma segunda conexão
  // (view-only, hidden) em vez do stream local direto.
  hostPreviewEnabled: boolean
  onToggleHostPreview: () => void
  attachHostPreviewVideo: (element: HTMLVideoElement | null) => void
  getHostPreviewStats: () => Promise<RawTrackStats | undefined>
  getHostPreviewBitrate: () => number
  // Precisa sobreviver à troca de tela (Home <-> Transmissão) — por isso
  // vive no App, não aqui (esse componente desmonta ao navegar pra
  // TransmissionScreen). Só reinicia (volta pro padrão expandido) no
  // logout, ver handleLogout em App.tsx.
}

function HomeScreen({
  user,
  // Pedido do usuário (2026-09-03): `appVersion` sem uso enquanto o
  // header (único lugar que usava) está comentado logo abaixo — NÃO
  // remover o prop em si (ver comentário junto do header comentado), só
  // marcado como intencionalmente não lido por enquanto (`_`, convenção
  // do TS, + eslint-disable porque a regra do ESLint não segue essa
  // convenção sozinha). `onLogout` voltou a ser usado (2026-09-04): botão
  // de sair dentro do popover de perfil, ver UserProfileModal.tsx.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  appVersion: _appVersion,
  onLogout,
  onUserUpdate,
  rooms,
  userAvatars,
  presence,
  apiBaseUrl,
  hiddenOwnRoomCode,
  refreshingRooms,
  onRefreshRooms,
  viewerRoomCodes,
  popinRoomCode,
  onPopinRoom,
  onJoinRoom,
  onLeaveRoom,
  getAttachViewerVideo,
  getAttachViewerAudioContainer,
  viewerAudioSettings,
  onSetViewerVolume,
  onSetViewerMuted,
  getViewerStatsFetcher,
  getViewerBitrateFetcher,
  getAttachViewerCamVideo,
  viewerHiddenFeeds,
  onSetViewerFeedVisible,
  onOpenPicker,
  webcamStatus,
  onStopWebcam,
  transmitting,
  launchingTransmission,
  stoppingTransmission,
  roomCode,
  webcamDeviceName,
  webcamStartedAt,
  attachWebcamPreviewVideo,
  transmissionStartedAt,
  nowPlaying,
  transmissionSettings,
  onNotify,
  chatRooms,
  onSendChat,
  onChatRead,
  onSetChatMuted,
  onStopTransmission,
  onUpdateTransmission,
  hostPreviewEnabled,
  onToggleHostPreview,
  attachHostPreviewVideo,
  getHostPreviewStats,
  getHostPreviewBitrate
}: HomeScreenProps): React.JSX.Element {
  // Diretório de contas. Vive AQUI, e não dentro do UsersSidebar, porque
  // aquele componente só existe enquanto o painel está aberto — buscar
  // lá dentro fazia cada clique no botão refazer um GET /users, o que o
  // usuário sentia como atraso ao abrir a lista (2026-09-11). Aqui ele
  // carrega uma vez e sobrevive a abrir/fechar quantas vezes for.
  const usersDirectory = useUsersDirectory(presence)
  // Amizades (2026-10-21) — aqui pelo mesmo motivo do diretório.
  const friends = useFriends()

  // O que o card de perfil precisa pra oferecer a amizade, de qualquer
  // lista onde ele abre (ver FriendsContext). O card só conhece o NOME —
  // as listas de quem assiste são de nomes —, então o id sai daqui.
  const idByNameMap = useMemo(
    () => new Map(usersDirectory.users.map((u) => [u.name, u.id])),
    [usersDirectory.users]
  )

  // Status por NOME (2026-09-13) — a junção que nenhuma das listas de
  // viewers consegue fazer sozinha.
  //
  // O problema: quem está assistindo chega como uma lista de NOMES (as
  // identities do LiveKit), e o mapa de presença é por ID. O diretório
  // de contas é o único lugar que tem os dois, e ele vive aqui.
  //
  // Reagrupa quando o diretório carrega ou quando alguém muda de
  // estado — as duas coisas já re-renderizam esta tela.
  const statusByName = useMemo(() => {
    const byName: Record<string, UserCardStatus> = {}
    for (const account of usersDirectory.users) {
      byName[account.name] = presence[account.id] ?? 'offline'
    }
    return byName
  }, [usersDirectory.users, presence])

  // Ficha de usuário e menu de "Expulsar" (2026-09-13). Os dois são
  // exclusivos: abrir um fecha o outro, senão o card ficaria por baixo
  // do menu sem nenhuma relação com ele.
  const [userCard, setUserCard] = useState<UserCardTarget | null>(null)
  const closeUserCard = useCallback(() => setUserCard(null), [])
  const [kickMenu, setKickMenu] = useState<{
    name: string
    position: ContextMenuPosition
  } | null>(null)
  const closeKickMenu = useCallback(() => setKickMenu(null), [])

  // Ver UsersSidebar.tsx pro porquê do stopPropagation e de medir o
  // retângulo antes do setState.
  function openUserCard(event: React.MouseEvent<HTMLElement>, name: string): void {
    event.stopPropagation()
    // Ancora no <li> e não no botão — ver UsersSidebar.tsx.
    const tile = event.currentTarget.closest('li') ?? event.currentTarget
    const rect = tile.getBoundingClientRect()
    setKickMenu(null)
    setUserCard((current) =>
      current?.name === name
        ? null
        : {
            name,
            avatar: userAvatars[name] ?? null,
            status: statusByName[name] ?? 'offline',
            rect
          }
    )
  }

  // Expulsar alguém da MINHA live (2026-09-13, pedido do usuário).
  //
  // Não há nada a limpar aqui depois: quem sai da sala some da lista de
  // participantes no próximo broadcast, que é a mesma fonte em tempo
  // real que desenha esta lista. E se a sala for privada, o servidor
  // ainda tira a pessoa da lista de permissão — a sala desaparece da
  // tela dela junto.
  async function handleKick(name: string): Promise<void> {
    if (!myRoomCode) return
    try {
      await window.api.users.kick(myRoomCode, name)
      onNotify(`${name} saiu da sua transmissão`)
    } catch (err) {
      onNotify(getErrorMessage(err, 'Não foi possível expulsar este usuário'), true)
    }
  }

  const [showUpdateModal, setShowUpdateModal] = useState(false)

  // Item 5 do roadmap, 2a parte (2026-09-09): o que a sub-barra esta
  // mostrando. Um estado SO pros dois conteudos possiveis, em vez de um
  // booleano por painel: assim e impossivel abrir os dois ao mesmo tempo
  // (eles disputam o mesmo espaco na tela) e nao ha dois estados pra
  // manter em sincronia. `null` = sub-barra fechada.
  //
  // No caso da sala guarda o CODIGO, nao o objeto: o `rooms` e recriado
  // a cada broadcast em tempo real, e um objeto guardado aqui
  // congelaria no estado do momento do clique (jogo, viewers, tudo).
  // Mesmo motivo do `passwordPromptRoomCode` acima.
  //
  // Isto e SO o painel — nao tem relacao com receber o feed, que e
  // `viewerRoomCodes`. Da pra ter o painel aberto sem assistir, assistir
  // sem o painel, os dois, ou nenhum.
  const [sidePanel, setSidePanel] = useState<
    { kind: 'room'; code: string } | { kind: 'friends' } | { kind: 'members' } | null
  >(null)

  const friendsContext = useMemo<FriendsContextValue>(
    () => ({
      friends,
      idByName: (name) => idByNameMap.get(name) ?? null,
      selfId: user.id,
      notify: onNotify,
      pinned: usersDirectory.pinned,
      togglePin: usersDirectory.setPinned,
      roomOfHost: (name) => {
        const room = rooms.find((r) => r.hostName === name)
        if (!room) return null
        return {
          code: room.name,
          game: room.game,
          viewers: room.participants.filter((p) => p !== room.hostName).length
        }
      },
      openRoom: (code) => setSidePanel({ kind: 'room', code })
    }),
    [
      friends,
      idByNameMap,
      user.id,
      onNotify,
      usersDirectory.pinned,
      usersDirectory.setPinned,
      rooms,
      setSidePanel
    ]
  )

  // Revalida o diretório de contas toda vez que o painel ABRE
  // (2026-09-20). Complementa a detecção por presença lá do hook: aquela
  // só percebe quem se cadastrou E entrou; esta pega também a conta que
  // foi criada e ainda não logou, no único momento em que isso importa —
  // quando alguém vai olhar a lista.
  //
  // Isto não desfaz a correção de 2026-09-11 (buscar ao abrir era o
  // problema de então): lá o componente era REMONTADO e a busca voltava
  // do zero, com a tela em "Carregando...". Aqui os dados continuam na
  // mão, a lista aparece instantaneamente com o que já se sabia, e a
  // busca só troca o conteúdo se algo mudou.
  //
  // Os DOIS painéis de pessoas (2026-10-21): a Lista de Amigos e os
  // Membros. Um efeito por painel, pra abrir um com o outro já aberto
  // também revalidar.
  const friendsPanelOpen = sidePanel?.kind === 'friends'
  const refreshUsersDirectory = usersDirectory.refresh
  useEffect(() => {
    if (friendsPanelOpen) refreshUsersDirectory()
  }, [friendsPanelOpen, refreshUsersDirectory])
  // MEMBROS (2026-10-21): mais um painel do MESMO lugar (`sidePanel`),
  // como a Lista de amigos e a ficha de uma sala — pedido do usuário:
  // tudo que a barra da esquerda abre concorre pelo mesmo espaço.
  const membersOpen = sidePanel?.kind === 'members'
  useEffect(() => {
    if (membersOpen) refreshUsersDirectory()
  }, [membersOpen, refreshUsersDirectory])
  // Modal de preferências da conta (2026-09-06). Fica aqui, e não dentro
  // do UserProfileModal que tem o botão, porque é centralizado na janela
  // — dentro do popover ele herdaria o posicionamento/overflow da barra
  // e não conseguiria cobrir a tela. Quem abre é o popover de perfil da
  // AppLeftSidebar, via `onOpenSettings`.
  //
  // O estado do POPOVER em si saiu daqui em 2026-09-09, junto com a
  // sidebar antiga: quem controla abrir/fechar (e o clique fora) agora é
  // a AppLeftSidebar, que é onde o avatar mora.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Janela de perfil (2026-10-19) — mesma lógica do modal de
  // Configurações acima: aberta pelo popover, renderizada aqui.
  const [profileWindowOpen, setProfileWindowOpen] = useState(false)
  // (Item 9, "entrar com código", saiu em 2026-10-21 a pedido do
  // usuário: a sala continua tendo código, mas não se entra mais por ele.)
  // REMOVIDO (2026-09-05): aqui vivia um ResizeObserver que media o
  // `.live-tile-title` e aplicava a largura dele como `max-width` inline
  // do subtítulo (o nome do jogo). Aquilo existia porque o tile era
  // dimensionado pelo CONTEÚDO — sem o limite, um nome comprido esticava
  // o tile inteiro.
  //
  // Não voltou a ser necessário nem quando o tile deixou de ter largura
  // fixa (2026-09-14, hoje ele ocupa o espaço livre do rodapé): quem
  // segura o nome comprido é o `overflow: hidden` do `.live-tile-info`
  // somado ao `min-width: 0` da coluna, e o nome trunca com reticências
  // sozinho. Medir em JS aqui seria refazer em código o que o CSS já faz.
  // Item 32 do roadmap ("Modo foco"): qual tile está expandido pra ocupar
  // a janela toda, se algum — 'host-preview' pro preview do próprio host
  // (item 15) ou o `code` da sala, pra uma live assistida (item 23, N
  // simultâneas). Desde 2026-10-22 entra pelo botão de foco de cada tile
  // (o clique no vídeo virou o destaque, abaixo). Só um por vez, de propósito (expandir cobre a janela
  // toda, não dá pra ver dois ao mesmo tempo). Fica aqui (não dentro de
  // ViewerTile/HostPreviewTile) porque focar UM precisa esconder os
  // outros — ver `.watch-grid-has-focus` no CSS.
  const [focusedTile, setFocusedTile] = useState<string | null>(null)

  function toggleFocus(tileId: string): void {
    setFocusedTile((current) => (current === tileId ? null : tileId))
  }

  // DESTAQUE (2026-10-22, pedido do usuário): clicar numa live com outras
  // abertas leva ela pra linha de cima, grande, e as demais viram uma
  // fileira centralizada embaixo. Clicar em outra da fileira troca; clicar
  // na própria destacada volta pra grade. Independente do foco de
  // propósito: o foco (agora pelo botão de cada tile) entra a partir de
  // qualquer layout e, ao sair, a grade volta exatamente como estava —
  // por isso são dois estados e não um.
  const [featuredTile, setFeaturedTile] = useState<string | null>(null)

  function toggleFeatured(tileId: string): void {
    setFeaturedTile((current) => (current === tileId ? null : tileId))
  }

  // Item 32 do roadmap: se o tile focado desaparecer (host parou de
  // transmitir e escondeu o preview, ou a sala assistida caiu por um
  // caminho que não passa por um clique aqui — ex: o host do outro lado
  // encerrou a live, useViewer.ts tira o código de viewerRoomCodes
  // sozinho, via webhook), volta pro grid normal em vez de ficar preso
  // numa tela cheia vazia. `setState` direto no efeito é proposital aqui
  // (não dá pra derivar sem ele): é reação a um estado EXTERNO mudando
  // (LiveKit/webhook), não algo calculável a partir de props no render.
  //
  // O tile da webcam (2026-10-20) tem id `<código>:cam`, e some também
  // quando o host desliga a câmera ou a pessoa fecha só ele.
  useEffect(() => {
    if (!focusedTile) return
    let stillExists: boolean
    if (focusedTile === 'host-preview') {
      stillExists = hostPreviewEnabled && transmitting
    } else if (focusedTile.endsWith(':cam')) {
      const code = focusedTile.slice(0, -':cam'.length)
      stillExists =
        viewerRoomCodes.includes(code) &&
        roomSources(rooms.find((r) => r.name === code)).cam &&
        !viewerHiddenFeeds[code]?.cam
    } else {
      stillExists = viewerRoomCodes.includes(focusedTile) && !viewerHiddenFeeds[focusedTile]?.screen
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!stillExists) setFocusedTile(null)
  }, [focusedTile, hostPreviewEnabled, transmitting, viewerRoomCodes, rooms, viewerHiddenFeeds])

  // Pedido do usuário (2026-09-03): com o "Modo foco" ligado, a
  // titleBarOverlay (nativa, botões de minimizar/maximizar/fechar) troca
  // de transparente pra opaca (cor de fundo da Home) — `.watch-tile-
  // focused` já reserva o espaço de verdade pra ela no CSS (não é mais
  // sobreposta pelo vídeo). Uma classe no `<body>` (não dá pra passar
  // prop — `TitleBar.tsx` é montado no App.tsx, fora da árvore da
  // HomeScreen) deixa o CSS do lado ÍCONE+TÍTULO (`.app-titlebar`,
  // renderer) acompanhar; a parte NATIVA (botões) precisa do IPC porque
  // só o main process controla ela (`setTitleBarOverlay`).
  useEffect(() => {
    const focused = focusedTile !== null
    document.body.classList.toggle('app-focus-mode', focused)
    window.api.app.setTitleBarFocused(focused)
  }, [focusedTile])

  // Rede de segurança: se a HomeScreen desmontar com um tile ainda
  // focado (ex: fechar o app nesse estado), não deixa a titleBar
  // presa no modo "opaco" pra sempre.
  useEffect(() => {
    return () => {
      document.body.classList.remove('app-focus-mode')
      window.api.app.setTitleBarFocused(false)
    }
  }, [])

  // Item 19 do roadmap: a própria transmissão do host nunca aparece na
  // lista de salas pra ele mesmo. Item 38: usa `hiddenOwnRoomCode` (não
  // `roomCode` direto) — continua escondendo mesmo depois da transmissão
  // local já ter "terminado", até a sala sumir de vez de `rooms` em
  // tempo real (ver useHiddenOwnRoomCode.ts pro race condition que isso
  // corrige: as chamadas de DELETE podem confirmar sucesso antes do
  // webhook `room_finished` propagar).
  const visibleRooms = rooms.filter((room) => room.name !== hiddenOwnRoomCode)

  // Itens 17-18 do roadmap: quantidade/nomes de quem está assistindo a
  // própria live — sai de graça da mesma lista em tempo real (`rooms`,
  // via webhook) que alimenta a barra lateral, filtrando a própria
  // identidade (o host também "está" na sala, do ponto de vista do
  // LiveKit). Não precisa entrar como um segundo participante escondido
  // igual o app antigo fazia.
  const myRoom = rooms.find((room) => room.name === roomCode)
  // Codigo da MINHA live no ar, privada ou nao; null quando nao estou
  // transmitindo. E o que liga expulsar, o chat e a sobreposicao.
  const myRoomCode = roomCode ?? null

  // A live já existe DE VERDADE no servidor? (2026-09-13)
  //
  // O `roomCode` é definido assim que o `gstreamer:start` responde — e
  // ele responde quando o PROCESSO foi lançado, não quando a transmissão
  // está no ar. A sala só passa a existir pro servidor quando o
  // GStreamer negocia o WHIP e começa a publicar (webhook
  // `room_started`), e o `hostName` só é preenchido no
  // `participant_joined` seguinte.
  //
  // `myRoom?.hostName` cobre as DUAS etapas de uma vez: a sala estar
  // na lista prova que o `room_started` chegou, e o `hostName`
  // preenchido prova que o `participant_joined` do publisher também.
  // Nasceu pro botão de convidar (que dava 404 nesse intervalo); o
  // convite saiu em 2026-10-21 (item 26, etapa 5) e ela ficou pro selo.
  const roomPublished = Boolean(myRoom?.hostName)

  // A SALA JÁ ESTÁ PUBLICADA PRO MUNDO? (2026-10-13, "fast start")
  //
  // Desde esta data a Home volta a aparecer quando o PIPELINE está
  // rodando (passo 5 de 8, ver PipelineOutcome em
  // useGstreamerTransmission.ts), e não mais quando o servidor publica a
  // sala (passo 8). Entre um e outro passam uns segundos de rede, e
  // nesse intervalo a live existe pro host mas ainda não existe pra mais
  // ninguém.
  //
  // É o `roomPublished` logo acima mais o pipeline rodando, desde
  // 2026-10-16 ("start instantâneo"): a ficha aparece no clique e a sala,
  // com host, logo depois — antes de haver vídeo. O selo continua
  // dizendo "iniciando" até a captura estar de pé.
  const liveNoAr = roomPublished && !launchingTransmission

  // O CRONÔMETRO É DE CADA TRANSMISSÃO desde 2026-10-20 (item 26, etapa
  // 4), e por isso o relógio local. Antes ele usava o `startedAt` que o
  // LiveKit grava na SALA — mas a sala agora pode ter sido aberta pela
  // outra transmissão, e aí o relógio dela mentiria sobre esta. O local é
  // marcado no clique e não zera numa troca de fonte (só o `start` o
  // marca), então ele já cobre o que o oficial cobria.

  // A MINHA LIVE E A SALA (etapa 4; o rodapé virou a aba da minha live na
  // etapa 7). A aba existe com qualquer uma das transmissões no ar ou
  // parando; o selo da sala está no ar assim que qualquer uma chegou lá.
  const webcamOn = webcamStatus !== 'idle'
  const anyStopping = stoppingTransmission || webcamStatus === 'stopping'
  const myLiveActive = transmitting || stoppingTransmission || webcamOn
  const roomLive = (transmitting && liveNoAr) || webcamStatus === 'live'

  // O RODAPÉ DA MINHA LIVE (2026-10-22, pedido do usuário — voltou, no
  // lugar da aba da etapa 7). Sempre aberto com a live no ar (chegou a
  // recolher no mesmo dia; o recolher saiu). O chat é uma aba na direita,
  // aberta pelo botão dele no rodapé.
  const [chatOpen, setChatOpen] = useState(false)

  // A live acabar (as duas paradas) fecha o chat — na RENDERIZAÇÃO e não
  // num efeito: é o padrão do React pra "estado que reage a uma mudança
  // de prop" (o lint daqui recusa setState em efeito).
  if (chatOpen && !myLiveActive) setChatOpen(false)
  // A privacidade é da SALA, e quem a guarda é o registro do host — a
  // sala aberta só pela webcam não tem `transmissionSettings`.
  const roomPrivate = currentHostRoom()?.private ?? transmissionSettings?.private ?? false

  const myViewers = myRoom?.participants.filter((p) => p !== user.name) ?? []

  // --- Chat da live (item 21, 2026-09-23) -------------------------------
  //
  // O chat do HOST mora na aba da minha live desde 2026-10-21 (etapa 7):
  // o botão acima dos cartões, que expande pra cima como o chat de uma live
  // que eu assisto (ver MyLiveSidebar). Antes era uma barra lateral própria
  // na direita, aberta por um botão acima do rodapé — os dois saíram junto
  // com o rodapé. O estado aberto/fechado ficou dentro da aba.
  const myChat = myRoomCode ? (chatRooms[myRoomCode] ?? null) : null
  // O servidor manda a lista de silenciados por NOME e pra todo mundo da
  // sala (2026-09-23), então não é mais preciso cruzar com o diretório de
  // contas pra descobrir o id de cada um.
  //
  // Função simples, sem `useCallback`: é o padrão do arquivo (ver
  // `handleKick` acima), e envolver em `useCallback` fazia o React
  // Compiler desistir de otimizar a tela inteira.
  function isViewerMuted(name: string): boolean {
    return myChat?.mutedNames.has(name) ?? false
  }

  function onToggleChatMute(name: string, muted: boolean): void {
    if (!myRoomCode) return
    onSetChatMuted(myRoomCode, name, muted)
    onNotify(muted ? `${name} foi silenciado no chat` : `${name} voltou a falar no chat`)
  }

  // Alimenta a sobreposição de viewers (2026-09-10). Quem decide é AQUI
  // e não o main, porque as três coisas necessárias já estão juntas
  // nesta tela: a preferência do usuário, se há live no ar e quem está
  // assistindo. Espelhar isso no main seria o mesmo estado em dois
  // lugares.
  //
  // Roda de novo sozinho quando alguém entra ou sai, porque `myViewers`
  // sai do broadcast em tempo real — é daí que vem o "tempo real" da
  // overlay, sem canal próprio.
  const overlayViewerNames = myViewers.join(',')
  useEffect(() => {
    window.api.overlay.update({
      visible: Boolean(user.settings.showViewersOverlay && myRoomCode),
      viewers: myViewers.map((name) => ({ name, avatar: userAvatars[name] ?? null })),
      apiBaseUrl
    })
    // Depende de `overlayViewerNames` (string) e não de `myViewers`: o
    // array é recriado a cada render e dispararia o efeito sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.settings.showViewersOverlay, myRoomCode, overlayViewerNames, userAvatars, apiBaseUrl])

  // Item novo (2026-09-04, "sala com senha"): sala que abriu o modal de
  // senha, se ainda existir na lista em tempo real (pode ter caído
  // enquanto o modal estava aberto).
  // Resolvido a cada render a partir do `rooms` mais recente, entao o
  // painel acompanha o tempo real sozinho — e some quando o host encerra
  // (a sala sai da lista e o find devolve null), sem precisar limpar
  // estado em lugar nenhum.
  const detailsRoom =
    sidePanel?.kind === 'room' ? (rooms.find((room) => room.name === sidePanel.code) ?? null) : null

  // A EXPANSÃO AUTOMÁTICA DA LISTA DE ESPECTADORES SAIU (2026-09-23).
  //
  // Aqui viviam `viewersExpanded`, o `viewersAutoExpandedRef` e os dois
  // efeitos que abriam a aba sozinha na primeira pessoa a entrar e a
  // fechavam quando a live voltava a ficar vazia. Nada disso tem mais
  // sujeito, porque a aba não existe: quem está assistindo a minha live é
  // a linha de avatares no topo da barra do chat, que não abre nem fecha
  // por conta própria — ela está lá sempre que a barra está.

  // Item 35 do roadmap: som de entrada/saída — minha própria transmissão
  // (roomCode, se eu for o host) + toda sala que eu esteja assistindo
  // agora só a MINHA sala (pedido do usuário, 2026-09-06 — antes valia
  // pra toda sala assistida também). A sala inteira sumindo (host parou a
  // live) não toca nada aqui, ver useViewer.ts.
  //
  // O `anyStopping` (a tela ou a webcam parando) é o que cala o "saiu" enquanto EU derrubo a
  // minha própria live — ali os viewers somem da lista sem ter saído de
  // nada (ver o cabeçalho do hook).
  //
  // A MINHA sala é a do host (2026-10-20, item 26): aberta pela tela OU só
  // pela webcam — por isso `hiddenOwnRoomCode` (que segue as duas) e não o
  // `roomCode`, que é só o da tela.
  useRoomPresenceSounds(rooms, hiddenOwnRoomCode, user.name, anyStopping)

  // Alerta de LIVE NOVA (etapa 8, 2026-10-22): o som, o laranja da barra
  // de tarefas e o card no canto — conforme a preferência da conta (ver
  // useNewLiveAlerts.ts). Único alerta que passa por ela.
  //
  // Idem: a sala aberta só pela webcam também é minha, e não pode alertar
  // "live nova" pra mim mesmo.
  const isFriendByName = useCallback(
    (name: string) => {
      const id = idByNameMap.get(name)
      return id !== undefined && friends.friendIds.has(id)
    },
    [idByNameMap, friends.friendIds]
  )
  const liveAlerts = useNewLiveAlerts(
    rooms,
    hiddenOwnRoomCode,
    newLiveAlertsOf(user.settings),
    isFriendByName
  )

  // Os tiles que a grade mostra. A live que está no mini player
  // (2026-09-20) continua assistida — a conexão não é tocada —, ela só
  // não tem tile aqui.
  //
  // Cada sala assistida dá até DOIS tiles desde 2026-10-20 (item 26): o da
  // tela e o da webcam, lado a lado, cada um só se a sala tem aquela
  // transmissão e a pessoa não o fechou. O mini player leva só a tela.
  const watchTiles = viewerRoomCodes.flatMap((code) => {
    const sources = roomSources(rooms.find((r) => r.name === code))
    const hidden = viewerHiddenFeeds[code] ?? {}
    const tiles: { code: string; feed: RoomFeed }[] = []
    if (sources.screen && !hidden.screen && code !== popinRoomCode) {
      tiles.push({ code, feed: 'screen' })
    }
    if (sources.cam && !hidden.cam) tiles.push({ code, feed: 'cam' })
    return tiles
  })

  // Os ids de tudo que está na grade agora, na ordem dela — os mesmos ids
  // do `focusedTile`/`featuredTile`.
  const gridTileIds = [
    ...(hostPreviewEnabled && transmitting ? ['host-preview'] : []),
    ...watchTiles.map(({ code, feed }) => (feed === 'cam' ? `${code}:cam` : code))
  ]
  // Destaque só faz sentido com mais de uma live na grade.
  const canFeature = gridTileIds.length > 1
  const featuredInGrid = featuredTile !== null && gridTileIds.includes(featuredTile)

  // A live destacada saiu (fechou, foi pro mini player, a sala caiu) ou
  // sobrou uma só: volta pra grade. Mesmo motivo do `setState` em efeito
  // do `focusedTile` — reação a estado externo.
  useEffect(() => {
    if (!featuredTile) return
    if (!canFeature || !featuredInGrid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFeaturedTile(null)
    }
  }, [featuredTile, canFeature, featuredInGrid])

  // Fechar o tile de UMA transmissão (2026-10-20). Se a outra da mesma
  // sala continua à vista (inclusive a tela no mini player), só este
  // fecha; se era o último, é sair da live — como o X sempre foi.
  function closeFeed(code: string, feed: RoomFeed): void {
    const sources = roomSources(rooms.find((r) => r.name === code))
    const hidden = viewerHiddenFeeds[code] ?? {}
    const other: RoomFeed = feed === 'screen' ? 'cam' : 'screen'
    const otherVisible = sources[other] && !hidden[other]
    if (otherVisible) onSetViewerFeedVisible(code, feed, false)
    else onLeaveRoom(code)
  }

  // O "Assistir" de UMA transmissão, na ficha da sala (2026-10-20, pedido
  // do usuário — antes era um botão só, que abria as duas de uma vez e
  // ainda travava o app por um instante). Fora da sala, entra com a OUTRA
  // fechada — exista ela agora ou não: se o host ligar depois, ela só
  // aparece na ficha. Dentro, só reabre esta.
  function watchFeed(room: RoomInfo, feed: RoomFeed): void {
    if (!viewerRoomCodes.includes(room.name)) {
      const other: RoomFeed = feed === 'screen' ? 'cam' : 'screen'
      void onJoinRoom(room.name, undefined, [other])
      return
    }
    onSetViewerFeedVisible(room.name, feed, true)
  }

  // Na sala sem NENHUMA transmissão à vista — ex.: entrei só na webcam e o
  // host desligou a câmera, sobrando a tela que eu tinha deixado fechada.
  // É o mesmo caso de fechar o último tile: sai da live. `setState` em
  // efeito pelo mesmo motivo do `focusedTile` acima — reação a estado
  // externo (lista de salas / LiveKit).
  useEffect(() => {
    viewerRoomCodes.forEach((code) => {
      const room = rooms.find((r) => r.name === code)
      if (!room) return
      const sources = roomSources(room)
      // Sala sem transmissão nenhuma é estado de passagem (host trocando
      // de fonte) — quem decide o fim dela é o host, não este efeito.
      if (!sources.screen && !sources.cam) return
      const hidden = viewerHiddenFeeds[code] ?? {}
      const anyVisible = (sources.screen && !hidden.screen) || (sources.cam && !hidden.cam)
      if (!anyVisible) onLeaveRoom(code)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRoomCodes, rooms, viewerHiddenFeeds])

  // OS CARTÕES DA TELA E DA WEBCAM (etapa 4) — moravam na linha de baixo
  // do rodapé, que saiu em 2026-10-21 (etapa 7); agora são o pé da aba da
  // minha live (MyLiveSidebar). Mesmo conteúdo e mesmos controles: a Tela
  // com a arte, o nome, o tempo no ar, preview/definições/parar; a Webcam
  // com a miniatura ao vivo, o nome da câmera e o parar.
  const liveCards = (
    <>
      {/* CARTÃO DA TELA (redesenhado em 2026-10-21, no desenho do card do
          hover): o ícone (a arte do jogo), "Tela" com o tempo no ar e o que
          está sendo transmitido embaixo; na linha de baixo, preview,
          atualizar a live e o "Parar Transmissão". */}
      {stoppingTransmission ? (
        <div className="ml-tile ml-tile-screen ml-tile-stopping">
          <span className="live-status-stopping-spinner" />
          <span className="live-tile-stopping-label">Parando tela...</span>
        </div>
      ) : transmitting ? (
        <div className="ml-tile ml-tile-screen">
          {nowPlaying ? (
            <NowPlayingArt info={nowPlaying} />
          ) : (
            <span className="ml-tile-icon">
              <Monitor size={18} />
            </span>
          )}
          <div className="ml-tile-text">
            <span className="ml-tile-kind">
              Tela
              <span
                className={`ml-tile-dot${liveNoAr ? '' : ' ml-tile-dot-connecting'}`}
                aria-hidden="true"
              />
              <LiveTimer startedAt={transmissionStartedAt} className="ml-tile-timer" />
            </span>
            {/* No MarqueeText: título de janela costuma ser comprido, e ele
                só anima quando o texto não cabe — fica sempre numa linha. */}
            <div className="ml-tile-subtitle-box">
              <MarqueeText
                text={nowPlaying?.name ?? 'Tela compartilhada'}
                className="ml-tile-subtitle"
              />
            </div>
          </div>

          {/* Só botões de ícone, encostados no fim do tile (2026-10-22). */}
          <div className="ml-tile-actions">
            <Tooltip label={hostPreviewEnabled ? 'Ocultar preview' : 'Preview'} placement="top">
              <button
                type="button"
                className={`ml-tile-icon-button${hostPreviewEnabled ? ' ml-tile-icon-button-on' : ''}`}
                onClick={onToggleHostPreview}
                aria-label={
                  hostPreviewEnabled
                    ? 'Ocultar preview da transmissão'
                    : 'Mostrar preview da transmissão'
                }
              >
                {hostPreviewEnabled ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </Tooltip>
            <Tooltip label="Atualizar live" placement="top">
              <button
                type="button"
                className="ml-tile-icon-button"
                onClick={() => setShowUpdateModal(true)}
                aria-label="Atualizar a transmissão"
              >
                <SlidersHorizontal size={15} />
              </button>
            </Tooltip>
            <Tooltip label="Parar Transmissão" placement="top-end">
              <button
                type="button"
                className="ml-tile-icon-button ml-tile-stop"
                onClick={() => onStopTransmission()}
                aria-label="Parar a transmissão da tela"
              >
                <Square size={12} fill="currentColor" />
              </button>
            </Tooltip>
          </div>

          {/* O mesmo dialog do iniciar (2026-10-16), só com os rótulos de
              atualizar. Fecha no clique: a troca leva um ou dois segundos e
              uma falha chega pelo snackbar — ver update() em
              useGstreamerTransmission.ts. */}
          {showUpdateModal && transmissionSettings && (
            <SourcePickerDialog
              mode="update"
              initialQuality={{
                resolution: transmissionSettings.resolution,
                fps: transmissionSettings.fps
              }}
              initialPrivate={transmissionSettings.private}
              currentSourceId={transmissionSettings.sourceId}
              onClose={() => setShowUpdateModal(false)}
              onPick={(settings) => {
                setShowUpdateModal(false)
                // Privacidade não muda com a live no ar: trocar
                // resolução/FPS/fonte não recria a sala.
                void onUpdateTransmission({
                  ...settings,
                  private: transmissionSettings.private
                })
              }}
            />
          )}
        </div>
      ) : webcamOn ? (
        // A vaga da TELA, com só o vídeo no ar: o "Adicionar" (2026-10-22,
        // pedido do usuário) abre o seletor só com a Tela.
        <AddTransmissionTile kind="screen" onClick={() => onOpenPicker('screen')} />
      ) : null}

      {/* CARTÃO DA WEBCAM — miniatura ao vivo, o nome da câmera,
    o tempo no ar e o parar. Ver WebcamLiveCard.tsx. */}
      {webcamStatus !== 'idle' && (
        <WebcamLiveCard
          status={webcamStatus}
          deviceName={webcamDeviceName}
          startedAt={webcamStartedAt}
          attachVideo={attachWebcamPreviewVideo}
          onStop={onStopWebcam}
        />
      )}
      {webcamStatus === 'idle' && (transmitting || stoppingTransmission) && (
        <AddTransmissionTile kind="cam" onClick={() => onOpenPicker('cam')} />
      )}
    </>
  )

  return (
    // O contexto de amizades envolve a Home inteira: o card de perfil
    // abre de quatro lugares dela (ver FriendsContext).
    <FriendsContext.Provider value={friendsContext}>
      <div className="home-page">
        {/* Pedido do usuário (2026-09-03): header comentado (não removido)
          — a titleBar customizada (TitleBar.tsx) assumiu o papel de
          mostrar logo/nome/versão do app em toda tela. O botão de sair
          perdeu o lugar aqui por enquanto, mas a FUNÇÃO continua ligada
          via `onLogout` (prop) — "vamos usar ela futuramente", não é
          pra remover (só os bindings locais viraram `_appVersion`/
          `_onLogout` na desestruturação abaixo, convenção do
          TypeScript pra "intencionalmente não lido por enquanto" sem
          apagar o prop). Pra voltar com o header do jeito que estava:
          descomentar o bloco abaixo, tirar o `_` de `_appVersion`/
          `_onLogout` na desestruturação, e reimportar `logo` (de
          '../assets/logo.png') e `LogOut` (de 'lucide-react') lá em
          cima — foram tirados por ficarem sem uso nenhum com o header
          comentado. (2026-09-10: o rótulo de versão aqui dentro foi
          atualizado junto com os vivos pra usar `formatAppVersion` —
          descomentar isto um dia não deve trazer de volta um `v1.0.0`
          cru enquanto as outras telas mostram "BETA". Precisa importar
          de '../lib/appVersion'.)

      <header className="home-header">
        <div className="home-header-left">
          <img src={logo} alt="" className="app-logo" />
          <span className="app-name">Prisma</span>
          {(VERSION_LABEL || appVersion) && (
            <span className="app-version">{formatAppVersion(appVersion)}</span>
          )}
        </div>

        <div className="home-header-right">
          <button type="button" className="icon-button" onClick={onLogout} aria-label="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      */}

        <div className="home-body">
          {/* Item 5 do roadmap: a barra fina de SALAS AO VIVO. */}
          <AppLeftSidebar
            rooms={visibleRooms}
            userAvatars={userAvatars}
            user={user}
            apiBaseUrl={apiBaseUrl}
            onRoomClick={(room) =>
              // Alterna (2026-09-13, pedido do usuário): clicar no tile que
              // JÁ está aberto fecha o painel, igual o botão "<". Clicar em
              // outro tile troca pra ele.
              //
              // A comparação é com o `sidePanel` e não com o
              // `detailsRoom`: aquele é o que foi CLICADO, este é o
              // resultado de procurar a sala na lista. Se a sala sumir da
              // lista no meio do caminho (a live acabou), `detailsRoom`
              // vira null e o clique no mesmo tile abriria em vez de fechar.
              setSidePanel((current) =>
                current?.kind === 'room' && current.code === room.name
                  ? null
                  : { kind: 'room', code: room.name }
              )
            }
            activeRoomCode={detailsRoom?.name ?? null}
            watchingRoomCodes={viewerRoomCodes}
            onUsersClick={() =>
              // Mesmo toggle do tile de sala: clicar no botão de usuários
              // com o painel já aberto fecha.
              setSidePanel((current) => (current?.kind === 'friends' ? null : { kind: 'friends' }))
            }
            usersActive={sidePanel?.kind === 'friends'}
            incomingRequests={friends.incomingIds.length}
            onMembersClick={() =>
              setSidePanel((current) => (current?.kind === 'members' ? null : { kind: 'members' }))
            }
            membersActive={membersOpen}
            refreshingRooms={refreshingRooms}
            onRefreshRooms={onRefreshRooms}
            // UM BOTÃO SÓ DE TRANSMITIR (2026-10-22, pedido do usuário): abre
            // o seletor (Tela ou Vídeo). Com a live no ar ele SOME — quem
            // controla as transmissões é o rodapé.
            onOpenPicker={() => onOpenPicker()}
            // PRÉ-CARGA DA GRADE DE FONTES (2026-10-13): encostar o ponteiro
            // no botão já manda o main montar a grade de telas/janelas, que
            // é o que o seletor vai pedir. Sem `await` de propósito — o
            // main engole a falha (ver screenCapture:prefetch).
            onPrepareTransmission={() => void window.api.screenCapture.prefetch()}
            screenStatus={
              stoppingTransmission
                ? 'stopping'
                : transmitting
                  ? liveNoAr
                    ? 'live'
                    : 'starting'
                  : 'idle'
            }
            webcamStatus={webcamStatus}
            onOpenSettings={() => setSettingsOpen(true)}
            onUserUpdate={onUserUpdate}
            onLogout={onLogout}
            onOpenProfile={() => setProfileWindowOpen(true)}
          />

          {/* A COLUNA À DIREITA DA BARRA (2026-10-22): em cima os painéis da
              esquerda (detalhes, amigos, membros) e a área de lives lado a
              lado; embaixo o RODAPÉ DA MINHA LIVE, na largura das duas —
              ele passa por baixo dos painéis também (pedido do usuário). */}
          <div className="home-main">
            <div className="home-content">
              {membersOpen && (
                <MembersPanel
                  apiBaseUrl={apiBaseUrl}
                  users={usersDirectory.users}
                  loading={usersDirectory.loading}
                  loadError={usersDirectory.error}
                  liveAvatars={userAvatars}
                  presence={presence}
                  currentUserId={user.id}
                  friends={friends}
                  myViewers={myViewers}
                  onClose={() => setSidePanel(null)}
                />
              )}

              {sidePanel?.kind === 'friends' && (
                <FriendsSidebar
                  apiBaseUrl={apiBaseUrl}
                  users={usersDirectory.users}
                  loading={usersDirectory.loading}
                  loadError={usersDirectory.error}
                  liveAvatars={userAvatars}
                  presence={presence}
                  currentUserId={user.id}
                  pinned={usersDirectory.pinned}
                  friends={friends}
                  myViewers={myViewers}
                  onOpenMembers={() => setSidePanel({ kind: 'members' })}
                  onClose={() => setSidePanel(null)}
                  onNotify={onNotify}
                />
              )}

              {detailsRoom && (
                <RoomDetailsSidebar
                  room={detailsRoom}
                  userAvatars={userAvatars}
                  apiBaseUrl={apiBaseUrl}
                  isWatching={viewerRoomCodes.includes(detailsRoom.name)}
                  statusByName={statusByName}
                  onClose={() => setSidePanel(null)}
                  // Fechar o painel nao derruba nada — quem segura a live e
                  // `viewerRoomCodes`.
                  //
                  // Um Assistir/Sair POR TRANSMISSÃO (2026-10-20): sair de uma
                  // com a outra à vista só fecha aquela — ver closeFeed.
                  onWatchFeed={(feed) => watchFeed(detailsRoom, feed)}
                  onLeaveFeed={(feed) => closeFeed(detailsRoom.name, feed)}
                  // Chat só existe pra quem está assistindo (decisão do
                  // usuário): sem estar na live, `chatRooms` nem tem a sala —
                  // o useLiveChat só abre as que estão sendo assistidas.
                  chat={chatRooms[detailsRoom.name] ?? null}
                  selfName={user.name}
                  onSendChat={(text) => onSendChat(detailsRoom.name, text)}
                  onChatOpened={() => onChatRead(detailsRoom.name)}
                  hiddenFeeds={viewerHiddenFeeds[detailsRoom.name] ?? {}}
                />
              )}

              {/* REMOVIDO (2026-09-05, pedido do usuário): aqui ficava a faixa
            arrastável que redimensionava a sidebar. Agora a largura é
            fixa (285px, ver `.rooms-sidebar` no CSS) e não há mais nada
            pra arrastar — o hook, o estado em App.tsx e o `style` inline
            que sobrescrevia o CSS saíram junto. */}

              {/* A coluna da área de lives. Abrigava a grade e, embaixo, o RODAPÉ
            da minha live — que saiu em 2026-10-21 (etapa 7) e virou a aba
            da minha live, à esquerda (MyLiveSidebar). */}
              <div className="watch-column">
                {/* A LINHA de conteúdo. Levava, à direita da grade, a barra do
              chat do host — que foi pra aba da minha live na etapa 7. */}
                <div className="watch-row">
                  <main className="watch-area">
                    {/* Item 23 do roadmap: uma sala assistida por vez virou N —
                cada código em viewerRoomCodes é um tile próprio, todos
                simultâneos, dividindo o mesmo .watch-grid junto do preview
                do host (item 15), se ligado. */}
                    {/* O foco ganha do destaque enquanto dura, mas não o apaga:
                    saindo do foco, a grade volta pro layout em que estava. */}
                    <div
                      className={`watch-grid${
                        focusedTile
                          ? ' watch-grid-has-focus'
                          : featuredTile
                            ? ' watch-grid-featured'
                            : ''
                      }`}
                    >
                      {hostPreviewEnabled && transmitting && (
                        <HostPreviewTile
                          attachVideo={attachHostPreviewVideo}
                          fetchStats={getHostPreviewStats}
                          getBitrate={getHostPreviewBitrate}
                          focused={focusedTile === 'host-preview'}
                          onToggleFocus={() => toggleFocus('host-preview')}
                          featured={featuredTile === 'host-preview'}
                          onSelect={
                            canFeature && !focusedTile
                              ? () => toggleFeatured('host-preview')
                              : undefined
                          }
                        />
                      )}

                      {watchTiles.map(({ code, feed }) => {
                        const room = rooms.find((r) => r.name === code)
                        if (feed === 'cam') {
                          const camTileId = `${code}:cam`
                          return (
                            <ViewerCamTile
                              key={camTileId}
                              hostName={room?.hostName ?? '???'}
                              attachVideo={getAttachViewerCamVideo(code)}
                              onClose={() => closeFeed(code, 'cam')}
                              focused={focusedTile === camTileId}
                              onToggleFocus={() => toggleFocus(camTileId)}
                              featured={featuredTile === camTileId}
                              onSelect={
                                canFeature && !focusedTile
                                  ? () => toggleFeatured(camTileId)
                                  : undefined
                              }
                            />
                          )
                        }
                        const audio = viewerAudioSettings[code] ?? { volume: 1, muted: false }
                        // Item 28 do roadmap: quem mais está assistindo ESSA live —
                        // mesmo filtro do item 21 (exclui só o host, que publica,
                        // não assiste; inclui o próprio usuário logado, que também
                        // conta como alguém assistindo).
                        const roomViewers =
                          room?.participants.filter((p) => p !== room.hostName) ?? []
                        return (
                          <ViewerTile
                            key={code}
                            hostName={room?.hostName ?? '???'}
                            participants={roomViewers}
                            volume={audio.volume}
                            muted={audio.muted}
                            onSetVolume={(volume) => onSetViewerVolume(code, volume)}
                            onSetMuted={(muted) => onSetViewerMuted(code, muted)}
                            onLeave={() => closeFeed(code, 'screen')}
                            hasCam={roomSources(room).cam}
                            attachVideo={getAttachViewerVideo(code)}
                            attachAudioContainer={getAttachViewerAudioContainer(code)}
                            fetchStats={getViewerStatsFetcher(code)}
                            getBitrate={getViewerBitrateFetcher(code)}
                            focused={focusedTile === code}
                            onToggleFocus={() => toggleFocus(code)}
                            featured={featuredTile === code}
                            onSelect={
                              canFeature && !focusedTile ? () => toggleFeatured(code) : undefined
                            }
                            onPopin={() => onPopinRoom(code)}
                          />
                        )
                      })}

                      {watchTiles.length === 0 && !(hostPreviewEnabled && transmitting) && (
                        <div className="watch-empty">
                          <div className="watch-empty-icon">
                            <Tv size={32} />
                          </div>
                          <p className="watch-empty-title">Nenhuma live sendo assistida</p>
                          <p className="watch-empty-subtitle">
                            Clique em uma sala na lista ao lado pra assistir.
                          </p>
                        </div>
                      )}
                    </div>
                  </main>

                  {/* O CHAT DA MINHA LIVE, como ABA NA DIREITA (2026-10-22, pedido
                  do usuário — voltou de como era antes da etapa 7). Abre pelo
                  botão do chat no rodapé; aberto, a grade cede a largura. */}
                  {myChat && chatOpen && (
                    <aside className="live-chat-dock">
                      <div className="live-chat-dock-header">
                        <span className="live-chat-dock-title">
                          <MessageSquare size={14} />
                          Chat ao vivo
                        </span>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => setChatOpen(false)}
                          aria-label="Fechar chat ao vivo"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      <LiveChat
                        messages={myChat.messages}
                        loading={myChat.loading}
                        mutedNames={myChat.mutedNames}
                        userAvatars={userAvatars}
                        apiBaseUrl={apiBaseUrl}
                        onSend={(text) => onSendChat(myRoomCode as string, text)}
                        selfName={user.name}
                        onToggleMute={onToggleChatMute}
                      />
                    </aside>
                  )}
                </div>
              </div>
            </div>

            {/* O RODAPÉ DA MINHA LIVE (2026-10-22, pedido do usuário) — voltou,
              no lugar da aba da etapa 7: FLAT, colado nas bordas da área de
              lives, com só um fio claro em cima separando da grade. Existe
              enquanto houver transmissão no ar e ocupa espaço RESERVADO (a
              grade encolhe, nada fica por baixo dele). Duas linhas:

                Sala de <nome>  AO VIVO  Privada     Assistindo ooo  [💬 Chat]
                [ Tela ]  [ Vídeo ]  [ + Adicionar transmissão de … ]

              (Teve um "recolher" no mesmo dia; saiu a pedido do usuário.) */}
            {myLiveActive && (
              <footer className="live-dock">
                <div className="live-dock-head">
                  <span className="live-dock-title">Sala de {user.name}</span>
                  <span
                    className={
                      roomLive
                        ? 'tx-card-badge live-badge-snake'
                        : 'tx-card-badge tx-card-badge-connecting'
                    }
                    title={
                      roomLive
                        ? undefined
                        : 'Iniciando — sua sala já está aberta e o vídeo chega em instantes'
                    }
                  >
                    <span className="tx-card-dot" aria-hidden="true" />
                    {roomLive ? 'LIVE' : 'INICIANDO'}
                  </span>
                  {roomPrivate && (
                    <span className="room-details-private">
                      <Lock size={11} />
                      Privada
                    </span>
                  )}

                  <div className="live-dock-head-right">
                    {/* Quem está assistindo — clique abre o mini perfil,
                      botão direito abre Silenciar/Expulsar. */}
                    {myViewers.length > 0 && (
                      <div className="live-dock-viewers">
                        <span className="live-dock-viewers-label">
                          Assistindo
                          <span className="live-dock-viewers-count">{myViewers.length}</span>
                        </span>
                        <ViewerAvatarRow
                          names={myViewers}
                          userAvatars={userAvatars}
                          apiBaseUrl={apiBaseUrl}
                          max={8}
                          mutedNames={myChat?.mutedNames}
                          activeName={userCard?.name ?? null}
                          onViewerClick={openUserCard}
                          onViewerContextMenu={(event, name) => {
                            // Sem isto o Electron abre o menu de contexto
                            // padrão do Chromium por cima.
                            event.preventDefault()
                            event.stopPropagation()
                            setUserCard(null)
                            setKickMenu({ name, position: { x: event.clientX, y: event.clientY } })
                          }}
                        />
                      </div>
                    )}

                    {myChat && (
                      <Tooltip
                        label={chatOpen ? 'Fechar chat' : 'Chat ao vivo'}
                        placement="top-end"
                      >
                        <button
                          type="button"
                          className={`live-dock-button live-dock-button-text${chatOpen ? ' live-dock-button-on' : ''}${
                            !chatOpen && myChat.unread > 0 ? ' live-dock-button-unread' : ''
                          }`}
                          onClick={() => setChatOpen((open) => !open)}
                          aria-pressed={chatOpen}
                          aria-label={
                            myChat.unread > 0 && !chatOpen
                              ? `Abrir chat ao vivo (${myChat.unread} não lidas)`
                              : chatOpen
                                ? 'Fechar chat ao vivo'
                                : 'Abrir chat ao vivo'
                          }
                        >
                          <MessageSquare size={15} />
                          Chat
                          {!chatOpen && myChat.unread > 0 && (
                            <span className="live-dock-unread" aria-hidden="true" />
                          )}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>

                <div className="live-dock-tiles">{liveCards}</div>
              </footer>
            )}
          </div>
        </div>

        {profileWindowOpen && (
          <ProfileWindow
            user={user}
            apiBaseUrl={apiBaseUrl}
            onClose={() => setProfileWindowOpen(false)}
            onUserUpdate={onUserUpdate}
            onNotify={onNotify}
            onLogout={() => {
              setProfileWindowOpen(false)
              onLogout()
            }}
          />
        )}

        {settingsOpen && (
          <SettingsModal
            user={user}
            onClose={() => setSettingsOpen(false)}
            onUserUpdate={onUserUpdate}
          />
        )}

        {/* Os dois são portais pro <body> (ver os componentes), então o
          lugar deles aqui na árvore não afeta onde aparecem na tela —
          ficam no fim junto com os outros elementos flutuantes. */}
        {userCard && (
          <UserCardPopover
            target={userCard}
            apiBaseUrl={apiBaseUrl}
            // Alinha pelo topo do tile como as outras duas listas
            // (2026-09-14): chegou a ser `center` por um dia, quando a
            // suposição era de que aqui, no canto inferior direito, o topo
            // não teria o que acompanhar.
            //
            // Tem sim — e quando não cabe, o próprio card resolve: ele já
            // sobe sozinho pra não vazar pela borda de baixo da janela (o
            // clamp em UserCardPopover.tsx). Então pedir o alinhamento é
            // uma TENTATIVA que degrada bem, não uma aposta.
            //
            // Na horizontal ele vai abrir à esquerda do tile, com a mesma
            // folga de 12px: o flip acontece sozinho porque não há espaço à
            // direita, e é o que deixa o canto superior DIREITO do card
            // encostado no tile.
            onClose={closeUserCard}
          />
        )}

        {kickMenu && (
          <ContextMenu
            position={kickMenu.position}
            items={[
              // Silenciar vem ANTES de expulsar, e sem `danger`: é a
              // ação mais branda das duas (a pessoa continua assistindo,
              // só para de escrever), então é ela que deve estar no
              // caminho de menor resistência.
              {
                label: isViewerMuted(kickMenu.name) ? 'Liberar no chat' : 'Silenciar no chat',
                icon: isViewerMuted(kickMenu.name) ? (
                  <MessageSquare size={14} />
                ) : (
                  <MessageSquareOff size={14} />
                ),
                onSelect: () => onToggleChatMute(kickMenu.name, !isViewerMuted(kickMenu.name))
              },
              {
                label: 'Expulsar',
                icon: <UserMinus size={14} />,
                danger: true,
                onSelect: () => handleKick(kickMenu.name)
              }
            ]}
            onClose={closeKickMenu}
          />
        )}

        <NewLiveAlertStack
          alerts={liveAlerts.alerts}
          rooms={rooms}
          userAvatars={userAvatars}
          apiBaseUrl={apiBaseUrl}
          // Assistir entra na live (a tela, ou o vídeo se for só ele) e
          // abre a ficha da sala, como o Assistir de lá.
          onWatch={(room) => {
            watchFeed(room, roomSources(room).screen ? 'screen' : 'cam')
            setSidePanel({ kind: 'room', code: room.name })
          }}
          onDetails={(code) => setSidePanel({ kind: 'room', code })}
          onDismiss={liveAlerts.dismiss}
        />
      </div>
    </FriendsContext.Provider>
  )
}

export default HomeScreen
