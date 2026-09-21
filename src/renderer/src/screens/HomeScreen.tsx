import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  SlidersHorizontal,
  Square,
  Tv,
  UserMinus,
  Users
} from 'lucide-react'
import { TransmissionSettings } from '../lib/transmissionSettings'
import { PresenceMap, RoomInfo } from '../lib/useRooms'
import { NowPlayingInfo } from '../lib/nowPlaying'
import { AuthUser } from '../lib/authUser'
import { ViewerAudioState } from '../lib/useViewer'
import { RawTrackStats } from '../lib/useTrackStats'
import UpdateTransmissionModal from '../components/UpdateTransmissionModal'
import SettingsModal from '../components/SettingsModal'
import HostPreviewTile from '../components/HostPreviewTile'
import ViewerTile from '../components/ViewerTile'
import LiveTimer from '../components/LiveTimer'
import UserAvatar from '../components/UserAvatar'
import AppLeftSidebar from '../components/AppLeftSidebar'
import RoomDetailsSidebar from '../components/RoomDetailsSidebar'
import UsersSidebar from '../components/UsersSidebar'
import JoinByCodeModal from '../components/JoinByCodeModal'
import NowPlayingArt from '../components/NowPlayingArt'
import { AvatarRef } from '../lib/avatar'
import { useRoomPresenceSounds } from '../lib/useRoomPresenceSounds'
import { useNewLiveSound } from '../lib/useNewLiveSound'
import { useUsersDirectory } from '../lib/useUsersDirectory'
import { useInviteTracking } from '../lib/useInviteTracking'
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
  onJoinRoom: (code: string, password?: string) => Promise<{ ok: boolean; error?: string }>
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
  // Transmissão via GStreamer (ver useGstreamerTransmission.ts) — a
  // mesma TransmissionScreen de sempre (itens 9/10/11) dispara isso.
  onNavigateTransmission: () => void
  transmitting: boolean
  // Pedido do usuário (2026-08-31): entre clicar em "Parar" e a sala ser
  // confirmada derrubada de verdade (ver useGstreamerTransmission.ts,
  // que insiste até confirmar) — footer mostra "Parando transmissão..."
  // em vez dos controles normais nesse meio tempo.
  stoppingTransmission: boolean
  roomCode: string | null
  // Item 29 do roadmap: jogo (Steam/lista do Discord) ou título da janela
  // sendo transmitida agora, detectado pelo main — null enquanto nada foi
  // identificado ainda.
  nowPlaying: NowPlayingInfo | null
  transmissionSettings: TransmissionSettings | null
  transmissionError: string | null
  // Mensagem no snackbar (quem renderiza ele é o App, pra sobreviver a
  // troca de tela). Usado pelo retorno de convite enviado/falhou e
  // pelo upload de foto de perfil.
  //
  // `durationMs: 0` deixa a mensagem FIXA até alguém trocá-la — é
  // como o upload avisa que está em andamento sem sumir no meio (ver
  // useSnackbar.ts).
  onNotify: (message: string, isError?: boolean, options?: { durationMs?: number }) => void
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
  onNavigateTransmission,
  transmitting,
  stoppingTransmission,
  roomCode,
  nowPlaying,
  transmissionSettings,
  transmissionError,
  onNotify,
  onStopTransmission,
  onUpdateTransmission,
  hostPreviewEnabled,
  onToggleHostPreview,
  attachHostPreviewVideo,
  getHostPreviewStats,
  getHostPreviewBitrate,

}: HomeScreenProps): React.JSX.Element {
  // Diretório de contas. Vive AQUI, e não dentro do UsersSidebar, porque
  // aquele componente só existe enquanto o painel está aberto — buscar
  // lá dentro fazia cada clique no botão refazer um GET /users, o que o
  // usuário sentia como atraso ao abrir a lista (2026-09-11). Aqui ele
  // carrega uma vez e sobrevive a abrir/fechar quantas vezes for.
  const usersDirectory = useUsersDirectory(presence)

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
  // O PIN de sala saiu em 2026-09-10, e com ele o modal que pedia a
  // senha antes de entrar. Uma sala privada simplesmente não chega até
  // aqui pra quem não foi convidado (o servidor filtra no broadcast),
  // então tudo que está na lista é entrável direto.
  function handleRoomTileClick(room: RoomInfo): void {
    onJoinRoom(room.name)
  }

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
    { kind: 'room'; code: string } | { kind: 'users' } | null
  >(null)

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
  const usersPanelOpen = sidePanel?.kind === 'users'
  const refreshUsersDirectory = usersDirectory.refresh
  useEffect(() => {
    if (usersPanelOpen) refreshUsersDirectory()
  }, [usersPanelOpen, refreshUsersDirectory])
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
  // Item 9: entrar numa sala digitando o código (o tile do "+" na barra
  // da esquerda).
  const [joinByCodeOpen, setJoinByCodeOpen] = useState(false)
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
  // simultâneas). Só um por vez, de propósito (expandir cobre a janela
  // toda, não dá pra ver dois ao mesmo tempo). Fica aqui (não dentro de
  // ViewerTile/HostPreviewTile) porque focar UM precisa esconder os
  // outros — ver `.watch-grid-has-focus` no CSS.
  const [focusedTile, setFocusedTile] = useState<string | null>(null)

  function toggleFocus(tileId: string): void {
    setFocusedTile((current) => (current === tileId ? null : tileId))
  }

  // Item 32 do roadmap: se o tile focado desaparecer (host parou de
  // transmitir e escondeu o preview, ou a sala assistida caiu por um
  // caminho que não passa por um clique aqui — ex: o host do outro lado
  // encerrou a live, useViewer.ts tira o código de viewerRoomCodes
  // sozinho, via webhook), volta pro grid normal em vez de ficar preso
  // numa tela cheia vazia. `setState` direto no efeito é proposital aqui
  // (não dá pra derivar sem ele): é reação a um estado EXTERNO mudando
  // (LiveKit/webhook), não algo calculável a partir de props no render.
  useEffect(() => {
    if (!focusedTile) return
    const stillExists =
      focusedTile === 'host-preview'
        ? hostPreviewEnabled && transmitting
        : viewerRoomCodes.includes(focusedTile)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!stillExists) setFocusedTile(null)
  }, [focusedTile, hostPreviewEnabled, transmitting, viewerRoomCodes])

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
  // Codigo da MINHA live no ar, privada ou nao (decisao do usuario,
  // 2026-09-10): convite vale pra qualquer sala. Numa publica e so um
  // atalho, ja que a pessoa poderia entrar pela lista; numa privada e o
  // unico caminho.
  //
  // null quando nao estou transmitindo — e o que esconde o botao de
  // convidar: sem live no ar nao ha pra onde convidar ninguem.
  const myRoomCode = roomCode ?? null

  // A live já existe DE VERDADE no servidor? (2026-09-13)
  //
  // BUG REAL reportado: convidar logo depois de iniciar a live dava
  // "Sala não encontrada", e o convite não saía.
  //
  // A causa é uma corrida de alguns segundos. O `roomCode` é definido
  // assim que o `gstreamer:start` responde — e ele responde quando o
  // PROCESSO foi lançado, não quando a transmissão está no ar. A sala
  // só passa a existir pro servidor bem depois, quando o GStreamer
  // negocia o WHIP e começa a publicar (webhook `room_started`), e o
  // `hostName` só é preenchido no `participant_joined` seguinte.
  //
  // Nesse intervalo a UI já dizia "ao vivo" e o botão de convidar já
  // estava clicável, mas o `roomsState` do servidor ainda não tinha a
  // sala — daí o 404. Um ou dois segundos depois, o mesmo clique
  // funcionava.
  //
  // `myRoom?.hostName` cobre as DUAS etapas de uma vez: a sala estar
  // na lista prova que o `room_started` chegou, e o `hostName`
  // preenchido prova que o `participant_joined` do publisher também —
  // que é exatamente o que a rota de convite exige (ela responde
  // "Só o host pode convidar" enquanto o nome está null).
  const liveReadyForInvites = Boolean(myRoom?.hostName)

  // Convites desta live: quem está pendente, quem aceitou (2026-09-14).
  // Vive aqui, e não no painel de usuários, porque o painel é
  // destruído ao fechar e o resultado pode chegar depois disso.
  const inviteTracking = useInviteTracking(myRoomCode, onNotify)

  const myViewers = myRoom?.participants.filter((p) => p !== user.name) ?? []

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
  }, [
    user.settings.showViewersOverlay,
    myRoomCode,
    overlayViewerNames,
    userAvatars,
    apiBaseUrl
  ])

  // Item novo (2026-09-04, "sala com senha"): sala que abriu o modal de
  // senha, se ainda existir na lista em tempo real (pode ter caído
  // enquanto o modal estava aberto).
  // Resolvido a cada render a partir do `rooms` mais recente, entao o
  // painel acompanha o tempo real sozinho — e some quando o host encerra
  // (a sala sai da lista e o find devolve null), sem precisar limpar
  // estado em lugar nenhum.
  const detailsRoom =
    sidePanel?.kind === 'room'
      ? (rooms.find((room) => room.name === sidePanel.code) ?? null)
      : null


  // Pedido do usuário (2026-09-04): a lista de quem está assistindo a
  // MINHA live expande sozinha automaticamente só na PRIMEIRA vez que
  // alguém entra na live atual — depois disso (mesmo que a lista seja
  // recolhida de novo), entradas/saídas seguintes nunca mais forçam a
  // expansão, só o botão de seta no header controla. `viewersAutoExpandedRef`
  // guarda se isso já aconteceu para a live atual; reseta a cada NOVA
  // live (roomCode muda) — ver os dois efeitos abaixo.
  const [viewersExpanded, setViewersExpanded] = useState(false)
  const viewersAutoExpandedRef = useRef(false)

  useEffect(() => {
    viewersAutoExpandedRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewersExpanded(false)
  }, [roomCode])

  useEffect(() => {
    if (myViewers.length === 0 || viewersAutoExpandedRef.current) return
    viewersAutoExpandedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewersExpanded(true)
  }, [myViewers.length])

  // Item 35 do roadmap: som de entrada/saída — minha própria transmissão
  // (roomCode, se eu for o host) + toda sala que eu esteja assistindo
  // agora só a MINHA sala (pedido do usuário, 2026-09-06 — antes valia
  // pra toda sala assistida também). A sala inteira sumindo (host parou a
  // live) não toca nada aqui, ver useViewer.ts.
  useRoomPresenceSounds(rooms, roomCode, user.name)

  // Alerta de "sala nova apareceu na lista" — único som que passa pela
  // preferência da conta (ver useNewLiveSound.ts pro porquê de o hook
  // continuar rodando mesmo desligado).
  useNewLiveSound(rooms, roomCode, user.settings.alertForNewLives)

  // Os tiles que a grade mostra. A live que está no mini player
  // (2026-09-20) continua assistida — a conexão não é tocada —, ela só
  // não tem tile aqui.
  const tilesVisiveis = viewerRoomCodes.filter((code) => code !== popinRoomCode)

  return (
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
            setSidePanel((current) => (current?.kind === 'users' ? null : { kind: 'users' }))
          }
          usersActive={sidePanel?.kind === 'users'}
          refreshingRooms={refreshingRooms}
          onRefreshRooms={onRefreshRooms}
          onJoinByCode={() => setJoinByCodeOpen(true)}
          onNavigateTransmission={onNavigateTransmission}
          transmitting={transmitting}
          onOpenSettings={() => setSettingsOpen(true)}
          onUserUpdate={onUserUpdate}
          onLogout={onLogout}
          onNotify={onNotify}
        />

        {sidePanel?.kind === 'users' && (
          <UsersSidebar
            apiBaseUrl={apiBaseUrl}
            users={usersDirectory.users}
            loading={usersDirectory.loading}
            loadError={usersDirectory.error}
            liveAvatars={userAvatars}
            presence={presence}
            currentUserId={user.id}
            myRoomCode={myRoomCode}
            liveReadyForInvites={liveReadyForInvites}
            pendingInvites={inviteTracking.pending}
            onInvited={inviteTracking.markInvited}
            myViewers={myViewers}
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
            // Mesmo caminho do tile da sidebar antiga: sala com PIN abre
            // o modal, sala aberta entra direto. Fechar o painel depois
            // nao derruba nada — quem segura a live e `viewerRoomCodes`.
            onWatch={() => handleRoomTileClick(detailsRoom)}
            onLeave={() => onLeaveRoom(detailsRoom.name)}
          />
        )}

        {/* REMOVIDO (2026-09-05, pedido do usuário): aqui ficava a faixa
            arrastável que redimensionava a sidebar. Agora a largura é
            fixa (285px, ver `.rooms-sidebar` no CSS) e não há mais nada
            pra arrastar — o hook, o estado em App.tsx e o `style` inline
            que sobrescrevia o CSS saíram junto. */}

        {/* Pedido do usuário (2026-09-04): o footer não cobre mais a
            janela inteira — agora acompanha só a largura da área de
            exibição de lives (não fica mais embaixo da sidebar). Esse
            wrapper (coluna: `.watch-area` em cima, `.home-footer`
            embaixo) é o que garante isso — os dois viram irmãos dentro
            dele em vez de o footer ser irmão de `.home-body` inteiro. */}
        <div className="watch-column">
          <main className="watch-area">
            {/* Item 23 do roadmap: uma sala assistida por vez virou N —
              cada código em viewerRoomCodes é um tile próprio, todos
              simultâneos, dividindo o mesmo .watch-grid junto do preview
              do host (item 15), se ligado. */}
            <div className={`watch-grid${focusedTile ? ' watch-grid-has-focus' : ''}`}>
              {hostPreviewEnabled && transmitting && (
                <HostPreviewTile
                  attachVideo={attachHostPreviewVideo}
                  fetchStats={getHostPreviewStats}
                  getBitrate={getHostPreviewBitrate}
                  focused={focusedTile === 'host-preview'}
                  onToggleFocus={() => toggleFocus('host-preview')}
                />
              )}

              {tilesVisiveis.map((code) => {
                const room = rooms.find((r) => r.name === code)
                const audio = viewerAudioSettings[code] ?? { volume: 1, muted: false }
                // Item 28 do roadmap: quem mais está assistindo ESSA live —
                // mesmo filtro do item 21 (exclui só o host, que publica,
                // não assiste; inclui o próprio usuário logado, que também
                // conta como alguém assistindo).
                const roomViewers = room?.participants.filter((p) => p !== room.hostName) ?? []
                return (
                  <ViewerTile
                    key={code}
                    hostName={room?.hostName ?? '???'}
                    participants={roomViewers}
                    volume={audio.volume}
                    muted={audio.muted}
                    onSetVolume={(volume) => onSetViewerVolume(code, volume)}
                    onSetMuted={(muted) => onSetViewerMuted(code, muted)}
                    onLeave={() => onLeaveRoom(code)}
                    attachVideo={getAttachViewerVideo(code)}
                    attachAudioContainer={getAttachViewerAudioContainer(code)}
                    fetchStats={getViewerStatsFetcher(code)}
                    getBitrate={getViewerBitrateFetcher(code)}
                    focused={focusedTile === code}
                    onToggleFocus={() => toggleFocus(code)}
                    onPopin={() => onPopinRoom(code)}
                  />
                )
              })}

              {tilesVisiveis.length === 0 && !(hostPreviewEnabled && transmitting) && (
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

          {/* O RODAPÉ SÓ EXISTE COM LIVE NO AR (2026-09-18, pedido do
              usuário).
              ------------------------------------------------------------
              Ele nasceu como a barra que segurava o botão "Transmitir";
              o botão virou um tile circular na barra da esquerda em
              2026-09-13, e desde então o rodapé ficava ali, vazio e
              transparente, comendo uma faixa da área de lives sem
              mostrar nada.

              As duas condições são os dois estados em que ele TEM
              conteúdo: transmitindo (as informações e os controles da
              minha live) e parando (o indicador de "Parando
              transmissão..."). Fora disso não há o que controlar, e a
              grade de lives ganha o espaço de volta.

              `home-footer-live` continua só trocando a COR de fundo — o
              tamanho é o mesmo nos dois estados em que ele aparece. */}
          {(transmitting || stoppingTransmission) && (
          <footer className={`home-footer${transmitting ? ' home-footer-live' : ''}`}>
            {/* Pedido do usuário (2026-09-04): o "tile" de USER INFO saiu
                daqui de vez (virou o "profile tile" fixo no rodapé da
                sidebar, ver acima) — esse lado esquerdo do footer agora é
                só as informações da MINHA transmissão (nada clicável,
                sem hover): "AO VIVO" + PIN (se a sala tiver senha) +
                timer numa linha, jogo/janela detectado (item 29) na de
                baixo, sem a animação de "virar" de antes (removida a
                pedido do usuário) — só aparece mesmo, sem esconder atrás
                de hover nenhum. */}
            <div className="home-footer-left">
              {!stoppingTransmission && transmitting && roomCode && (
                <div className="live-tile">
                  {/* Pedido do usuário (2026-09-05): arte do que está
                      sendo transmitido (capa do jogo ou placeholder) no
                      leading do tile. Só renderiza com `nowPlaying`
                      resolvido — sem info nenhuma não há placeholder
                      certo a escolher, e a janela de tempo até a
                      primeira detecção é curta (o monitor já reporta o
                      nome da tela de cara, ver gameDetection.ts). */}
                  {nowPlaying && <NowPlayingArt info={nowPlaying} />}

                  <div className="live-tile-info">
                    <div className="live-tile-title">
                      <span className="live-tile-dot" />
                      <span className="live-tile-label">AO VIVO</span>
                      {/* Sala privada (2026-09-10, no lugar do PIN):
                          lembra o host de que a live dele não está na
                          lista de ninguém — sem isso ele acharia que
                          ninguém quis entrar. */}
                      {transmissionSettings?.private && (
                        <>
                          <span className="live-tile-divider" />
                          <span className="live-tile-private-chip">
                            <Lock size={11} />
                            Privada
                          </span>
                        </>
                      )}
                      {/* Código da sala (2026-09-13, pedido do usuário).
                          Vem DEPOIS do selo "Privada" quando ele existe,
                          porque é essa a ordem do que a pessoa precisa
                          saber: primeiro que a live não está na lista de
                          ninguém, depois o número que ela vai passar pra
                          quem quer chamar.

                          É o mesmo `roomCode` que o guard deste bloco já
                          exige, então nunca renderiza vazio. */}
                      <span className="live-tile-divider" />
                      <span className="live-tile-code">{roomCode}</span>
                      <span className="live-tile-divider" />
                      {/* Item 42 do roadmap: há quanto tempo a MINHA live
                          está no ar — mesmo `myRoom` que já alimenta o
                          painel de quem está assistindo, só lendo
                          `startedAt` agora também. */}
                      <LiveTimer startedAt={myRoom?.startedAt} className="live-tile-timer" />
                    </div>

                    {/* Item 29 do roadmap: jogo/janela sendo transmitida
                        — sem "Clique para editar" embaixo (isso foi pro
                        profile tile da sidebar) e sem a animação de
                        virar de antes, mostra direto quando detectado. */}
                    {nowPlaying && (
                      <span className="live-tile-subtitle">              
                        <span className="now-playing-name">{nowPlaying.name}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Botão de iniciar live (quando não transmitindo) ou os
            controles da live (preview/atualizar/parar), alinhados à
            direita. Pedido do usuário (2026-09-02): botão de ver quem
            está assistindo (item 18) volta pra cá, à esquerda dos
            controles — antes tinha ido pro tile da esquerda junto do
            resto das informações da live. Pedido do usuário
            (2026-09-03): "Parando transmissão..." também fica aqui
            (nesse mesmo canto direito) em vez de junto do "USER INFO" à
            esquerda — sempre alinhado à direita do footer. */}
            <div className="home-footer-right">
              {stoppingTransmission ? (
                <span className="footer-stopping-indicator">
                  <span className="live-status-stopping-spinner" />
                  <span className="live-tile-stopping-label">Parando transmissão...</span>
                </span>
              ) : transmitting ? (
                <div className="home-live-controls">
                  {/* Item 18 do roadmap: tab que expande pra cima com os
                    nomes de quem está assistindo a própria live — painel
                    posicionado de forma absoluta (`bottom: 100%`) pra não
                    empurrar os outros controles do lugar quando abre/
                    fecha. Pedido do usuário (2026-09-04): trocou de HOVER
                    pra estado de verdade (`viewersExpanded`) — expande
                    sozinha só na primeira vez que alguém entra na live
                    atual (ver efeitos acima), depois disso só o botão de
                    seta no header abre/fecha. */}
                  <div className="participants-tab-wrapper">
                    {viewersExpanded ? (
                      <div className="participants-panel">
                        <div className="participants-panel-header">
                          <span className="participants-count">
                            <Users size={14} />
                            {myViewers.length}
                          </span>
                          <button
                            type="button"
                            className="participants-collapse-button"
                            onClick={() => setViewersExpanded(false)}
                            aria-label="Recolher lista de espectadores"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                        {myViewers.length === 0 ? (
                          <p className="participants-empty">Ninguém assistindo ainda.</p>
                        ) : (
                          <ul className="participants-list">
                            {myViewers.map((viewerName) => (
                              <li
                                key={viewerName}
                                className={
                                  userCard?.name === viewerName
                                    ? 'user-tile-active'
                                    : undefined
                                }
                              >
                                {/* Clique esquerdo abre a ficha; clique
                                    DIREITO abre o menu com "Expulsar"
                                    (2026-09-13). O menu só existe nesta
                                    lista: é a única em que eu sou o host,
                                    e só o host pode expulsar. */}
                                <button
                                  type="button"
                                  className="user-tile-button"
                                  onClick={(event) => openUserCard(event, viewerName)}
                                  onContextMenu={(event) => {
                                    // Sem isto o Electron abre o menu de
                                    // contexto padrão do Chromium por cima.
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setUserCard(null)
                                    setKickMenu({
                                      name: viewerName,
                                      position: { x: event.clientX, y: event.clientY }
                                    })
                                  }}
                                  aria-label={`Ver perfil de ${viewerName}`}
                                >
                                  <span className="mini-avatar">
                                    <UserAvatar
                                      avatar={userAvatars[viewerName]}
                                      apiBaseUrl={apiBaseUrl}
                                      size={13}
                                    />
                                  </span>
                                  <span className="viewer-name">{viewerName}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="participants-tab"
                        onClick={() => setViewersExpanded(true)}
                        aria-label="Ver quem está assistindo"
                      >
                        <Users size={14} />
                        {myViewers.length}
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={onToggleHostPreview}
                    aria-label={
                      hostPreviewEnabled
                        ? 'Ocultar preview da transmissão'
                        : 'Mostrar preview da transmissão'
                    }
                  >
                    {hostPreviewEnabled ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowUpdateModal(true)}
                    aria-label="Atualizar transmissão"
                  >
                    <SlidersHorizontal size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button-danger"
                    onClick={() => onStopTransmission()}
                    aria-label="Parar live"
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                  {showUpdateModal && transmissionSettings && (
                    <UpdateTransmissionModal
                      currentSettings={transmissionSettings}
                      onClose={() => setShowUpdateModal(false)}
                      onUpdate={onUpdateTransmission}
                      error={transmissionError}
                    />
                  )}
                </div>
              ) : (
                // Inalcançável desde 2026-09-18: o rodapé inteiro só é
                // montado quando `transmitting || stoppingTransmission`
                // (ver a condição lá em cima), então este terceiro caso
                // não acontece mais.
                //
                // Fica como o `else` explícito do ternário, que precisa
                // de um: o que sumiu daqui foi o botão "Transmitir", que
                // em 2026-09-13 virou um tile circular na barra da
                // esquerda (ver AppLeftSidebar.tsx).
                null
              )}
            </div>
          </footer>
          )}
        </div>
      </div>


      {joinByCodeOpen && (
        <JoinByCodeModal
          onClose={() => setJoinByCodeOpen(false)}
          onJoin={(code) => onJoinRoom(code)}
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
    </div>
  )
}

export default HomeScreen
