import { useEffect, useMemo, useState } from 'react'
import LoginScreen from './screens/LoginScreen'
import RegisterScreen from './screens/RegisterScreen'
import ForgotPasswordScreen from './screens/ForgotPasswordScreen'
import HomeScreen from './screens/HomeScreen'
import { useGstreamerTransmission } from './lib/useGstreamerTransmission'
import { useWebcamTransmission } from './lib/useWebcamTransmission'
import { currentHostRoom } from './lib/hostRoom'
import { useHostPreview } from './lib/useHostPreview'
import { useViewer } from './lib/useViewer'
import { useLiveChat } from './lib/useLiveChat'
import { useSnackbar } from './lib/useSnackbar'
import { absentFeeds, useRooms } from './lib/useRooms'
import { useAppUpdate } from './lib/useAppUpdate'
import { useReleaseNotes } from './lib/useReleaseNotes'
import { useHiddenOwnRoomCode } from './lib/useHiddenOwnRoomCode'
import { saveLastQuality } from './lib/lastTransmissionQuality'
import { nowPlayingFromSource } from './lib/nowPlaying'

import Snackbar from './components/Snackbar'
import UpdateDialog from './components/UpdateDialog'
import ReleaseNotesModal from './components/ReleaseNotesModal'
import PopinPlayer from './components/PopinPlayer'
import TitleBar from './components/TitleBar'
import SourcePickerDialog from './components/SourcePickerDialog'
import WebcamPickerDialog from './components/WebcamPickerDialog'
import TransmitKindSwitch, { TransmitKind } from './components/TransmitKindSwitch'

import iconName from './assets/iconName.png'
import { AuthUser } from './lib/authUser'

type AuthScreen = 'login' | 'register' | 'forgot'

// Tempo MÍNIMO que o splash de "carregando sessão" fica na tela (ver o
// useEffect que chama session.load()). Mexer aqui pra encurtar/alongar.
const SPLASH_MIN_MS = 1000

function App(): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login')
  // O SELETOR DE FONTE (2026-10-22, pedido do usuário): uma janela só pras
  // duas transmissões. `active` é a aba aberta (Tela ou Vídeo); `only`
  // trava nela — é o "Adicionar transmissão de vídeo/tela" do rodapé, com a
  // outra já no ar. Pelo botão da barra (nada no ar) as duas abas aparecem.
  // `switched`: a pessoa trocou de aba, então a janela nova entra sem a
  // animação de abertura (são duas janelas por baixo — ver TransmitKindSwitch).
  // `isPrivate`: a SALA privada é escolha de uma vez só, valha a aba que
  // valer — trocar de Tela pra Vídeo não desfaz (2026-10-22).
  const [picker, setPicker] = useState<{
    active: TransmitKind
    only: boolean
    switched: boolean
    isPrivate: boolean
  } | null>(null)
  const setPickerPrivate = (isPrivate: boolean): void =>
    setPicker((current) => (current ? { ...current, isPrivate } : current))

  const snackbar = useSnackbar()
  const transmission = useGstreamerTransmission((message) =>
    snackbar.show(message, { error: true })
  )
  // A WEBCAM (2026-10-20, item 26): uma segunda transmissão, independente
  // da tela, na MESMA sala do host — ver hostRoom.ts.
  const webcam = useWebcamTransmission((message) => snackbar.show(message, { error: true }))
  // A sala do host, aberta pela tela, pela webcam ou pelas duas. É ela
  // que some da minha própria lista e que tem o meu chat.
  const hostRoomCode = transmission.roomCode ?? webcam.roomCode
  const anyTransmission = transmission.transmitting || webcam.active
  // Só com a sala criada no servidor (2026-10-16): desde o "start
  // instantâneo" o `roomCode` existe a partir do clique, um instante antes
  // de haver sala onde o preview possa entrar.
  const hostPreview = useHostPreview(
    transmission.roomOpen ? transmission.roomCode : null,
    user?.name ?? null
  )
  // A miniatura da webcam no rodapé (2026-10-20, item 26, etapa 4): a
  // mesma gambiarra do preview da tela, numa conexão própria e sempre
  // ligada enquanto a webcam estiver no ar. A etapa 0 mostrou que o
  // preview não pode ser local — a câmera não abre em dois programas.
  const webcamPreview = useHostPreview(
    webcam.roomOpen ? webcam.roomCode : null,
    user?.name ?? null,
    { feed: 'cam', alwaysOn: true }
  )
  const viewer = useViewer(
    (reason) =>
      snackbar.show(
        reason === 'removed' ? 'Você foi removido da transmissão' : 'Transmissão encerrada'
      ),
    (message) => snackbar.show(message, { error: true })
  )
  // Chat temporário da live (2026-09-23). Um chat por sala ABERTA — as
  // que estou assistindo (item 23: dá pra assistir várias ao mesmo
  // tempo) mais a minha própria, quando estou transmitindo.
  //
  // A lista sai do `viewer.roomCodes`, e não dos lugares que chamam
  // `joinRoom`/`leaveRoom`, de propósito: ela é a única fonte que cobre
  // TODOS os caminhos de saída de uma sala, inclusive os que acontecem
  // sem ninguém clicar em nada — o host encerrar a live e ser expulso
  // caem no `leaveRoom` interno do useViewer.ts, que nenhum callback
  // daqui veria.
  const chat = useLiveChat(user?.name ?? null, (message) => snackbar.show(message, { error: true }))
  const chatRoomCodes = useMemo(
    () => (hostRoomCode ? [...viewer.roomCodes, hostRoomCode] : viewer.roomCodes),
    [viewer.roomCodes, hostRoomCode]
  )
  useEffect(() => {
    chat.syncRooms(chatRoomCodes)
  }, [chatRoomCodes, chat])

  const {
    rooms,
    userAvatars,
    presence,
    refreshing: refreshingRooms,
    refresh: refreshRooms,
    load: loadRooms
  } = useRooms((message) => snackbar.show(message, { error: true }))
  // Item 43 do roadmap: só o main process conhece API_BASE_URL (nunca
  // exposto direto por env var pro renderer) — precisa disso pra montar
  // a URL de uma foto de avatar customizada (<img src>).
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  // Item 38 do roadmap: esconde a própria sala da lista da sidebar até
  // ela realmente sumir da lista em tempo real — não só até as chamadas
  // de DELETE (ingress/sala) confirmarem sucesso, que podem terminar
  // antes do webhook `room_finished` propagar (ver
  // useHiddenOwnRoomCode.ts pro race condition que isso corrige).
  const hiddenOwnRoomCode = useHiddenOwnRoomCode(hostRoomCode, rooms)
  // Checagem/instalação de atualização — só ativa depois do login, mesmo
  // timing do app Flutter (ver useAppUpdate.ts).
  const appUpdate = useAppUpdate(Boolean(user))

  // Janela de notas da versão (2026-09-25). Mesmo `Boolean(user)` do
  // hook acima, e pelo mesmo motivo: nada disso pode acontecer por cima
  // da tela de login.
  const releaseNotes = useReleaseNotes(Boolean(user))

  // MINI PLAYER (2026-09-20, pedido do usuário) — qual live está na
  // janelinha sempre-no-topo, se alguma. Uma por vez (decisão do
  // usuário).
  //
  // O estado mora AQUI, e não na HomeScreen, por um motivo prático: a
  // janelinha não pode piscar quando a pessoa navega pra tela de iniciar
  // live, e é isso que aconteceria se ela dependesse de um componente
  // que desmonta nessa navegação.
  const [popinEscolhido, setPopinRoomCode] = useState<string | null>(null)

  // DERIVADO, e não sincronizado por efeito: a janelinha só existe
  // enquanto a live dela estiver de fato conectada. Quando o host
  // encerra (ou a conexão cai), `useViewer` tira o código de
  // `roomCodes` e a janelinha some no mesmo render — sem trazer o app
  // pra frente, como pedido.
  //
  // Um efeito que zerasse o estado faria a mesma coisa um render
  // depois, e nesse meio tempo o mini player ficaria pendurado numa
  // sala que já acabou.
  const popinRoomCode =
    popinEscolhido && viewer.roomCodes.includes(popinEscolhido) ? popinEscolhido : null

  // ...MAS A ESCOLHA TAMBÉM PRECISA SER ESQUECIDA (2026-09-21, bug
  // relatado pelo usuário).
  //
  // O derivado acima só ESCONDE: `popinEscolhido` continuava guardando o
  // código da sala depois de sair dela. Como o critério é "está na lista
  // de assistindo?", voltar pra MESMA live ressuscitava a janelinha — a
  // pessoa clicava em assistir e a live reaparecia no mini player em vez
  // de na área de exibição do app.
  //
  // Sair de uma live encerra a escolha "esta aqui fica na janelinha", e
  // entrar numa live é pedir pra vê-la no app. Os dois momentos abaixo
  // são eventos, não um efeito sincronizando estado: além de a regra do
  // projeto proibir `setState` dentro de efeito (ver useUsersDirectory),
  // é nesses dois cliques que a intenção realmente existe.
  const esquecerPopin = (code: string): void => {
    setPopinRoomCode((atual) => (atual === code ? null : atual))
  }

  const popinRoom = popinRoomCode ? rooms.find((room) => room.name === popinRoomCode) : undefined
  const popinAudio = (popinRoomCode ? viewer.audioSettings[popinRoomCode] : null) ?? {
    volume: 1,
    muted: false
  }
  // Item 29 do roadmap: lista de jogos detectáveis. Baixada em segundo
  // plano dentro do loading — o do botão de login (LoginScreen.tsx) e o
  // do splash do "manter conectado" (logo abaixo). Não tem mais tela de
  // progresso própria (2026-10-19, pedido do usuário): o overlay
  // "Atualizando dependências..." e o hook que o alimentava saíram.
  // Pedido do usuário (2026-08-31): fechar o app com uma transmissão
  // ativa agora espera de verdade a sala cair (main segura o fechamento
  // e avisa via 'app:before-quit', ver index.ts) — mostra um diálogo
  // bloqueante enquanto isso, em vez do fire-and-forget de antes.
  const [closingApp, setClosingApp] = useState(false)
  useEffect(() => {
    // `session.load()` é IPC puro (lê um arquivo local), resolve em poucos
    // milissegundos — o splash aparecia e sumia num piscar. Pedido do
    // usuário (2026-09-08): segurar por SPLASH_MIN_MS de propósito, pra
    // marca dar tempo de ser vista. É PISO, não soma: se o load demorar
    // mais que isso, o Promise.all já espera o load e não atrasa nada
    // além do necessário.
    Promise.all([
      window.api.session.load(),
      new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS))
    ]).then(async ([session]) => {
      // Sessão restaurada pelo "manter conectado": abre o WebSocket
      // AQUI, ainda no splash, antes de mostrar a Home (2026-09-13).
      //
      // Mesma razão do login: a conexão precisa do token, que só
      // existe depois do `session.load()`. Esperar aqui faz a Home
      // nascer com as salas em vez de vazia, preenchendo sozinha um
      // segundo depois.
      //
      // Só quando HÁ sessão: sem ela a próxima tela é o login, e é lá
      // que a conexão será aberta.
      //
      // Junto, ainda no splash (2026-10-19, pedido do usuário):
      //   - a lista de SALAS de agora, por HTTP — a Home nasce com ela e
      //     o alerta de live nova já vale (ver useNewLiveSound.ts);
      //   - a lista de jogos detectáveis, em segundo plano e sem barra.
      //     O main só baixa se o cache venceu. Antes ela era disparada ao
      //     montar o app, sem token, e tomava 401.
      // As duas em paralelo, depois da conexão (que é o que garante o
      // token). Nenhuma rejeita: servidor fora do ar não prende o splash.
      if (session) {
        await window.api.rooms.connect()
        await Promise.all([loadRooms(), window.api.games.ensureDetectableList().catch(() => {})])
      }

      setUser(session)
      setCheckingSession(false)
    })
  }, [])

  useEffect(() => {
    window.api.app.getApiBaseUrl().then(setApiBaseUrl)
  }, [])

  useEffect(() => window.api.app.onClosing(() => setClosingApp(true)), [])

  // JWT vencido (30 dias) ou inválido: o main avisa em qualquer 401 e o
  // app volta pra tela de login. Sem isso o usuário ficaria numa Home
  // que não carrega nada, tomando erro em cada ação sem entender por quê.
  //
  // Limpa a sessão gravada junto: se o "manter conectado" continuasse
  // apontando pro token morto, a próxima abertura cairia no mesmo
  // estado.
  useEffect(
    () =>
      window.api.auth.onSessionExpired(() => {
        window.api.rooms.disconnect()
        window.api.session.clear()
        setUser(null)
        setAuthScreen('login')
        snackbar.show('Sua sessão expirou. Entre de novo.', { error: true })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Bug real de produção (2026-09-06): o preview do host tem que cair
  // ANTES da sala ser derrubada. Enquanto ele seguia conectado, a
  // reconexão automática do livekit-client RECRIAVA a sala recém-apagada
  // (o `auto_create` do LiveKit é true e o token continua válido por
  // horas), e ela voltava pra lista de todo mundo como "Live de ???",
  // sem publisher nenhum. Todo caminho que para uma transmissão passa
  // por aqui — parar no botão, deslogar e fechar o app. Ver
  // useHostPreview.ts (`disconnect`/`NEVER_RECONNECT`).
  async function stopTransmission(): Promise<void> {
    hostPreview.disconnect()
    await transmission.stop()
  }

  // O mesmo cuidado pra webcam: a miniatura dela cai antes do ingress (e
  // da sala, se a webcam era a última).
  async function stopWebcam(): Promise<void> {
    webcamPreview.disconnect()
    await webcam.stop()
  }

  useEffect(() => {
    if (!closingApp) return
    ;(async () => {
      // As duas juntas (2026-10-20): a ordem não importa — a segunda a
      // sair da sala é quem a derruba (ver hostRoom.ts).
      await Promise.allSettled([
        transmission.transmitting ? stopTransmission() : Promise.resolve(),
        webcam.active ? stopWebcam() : Promise.resolve()
      ])
      window.api.app.confirmQuit()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closingApp])

  async function handleLogout(): Promise<void> {
    await Promise.allSettled([
      transmission.transmitting ? stopTransmission() : Promise.resolve(),
      webcam.active ? stopWebcam() : Promise.resolve()
    ])
    viewer.roomCodes.forEach((code) => viewer.leaveRoom(code, { silent: true }))
    // Fecha o WebSocket e PARA o ciclo de reconexão (2026-09-13) —
    // sem isto ele continuaria tentando com um token recém-apagado,
    // enchendo o log de 4401 exatamente como fazia antes do login.
    await window.api.rooms.disconnect()
    await window.api.session.clear()
    setUser(null)
    setAuthScreen('login')
  }

  // O <Snackbar> precisa sobreviver a troca de tela (ex: o viewer é
  // avisado que a live acabou enquanto está na Home) — por isso é
  // renderizado uma vez só, fora do if/else de qual tela mostrar, em vez
  // de duplicado em cada `return` abaixo.
  // A chave "Tela | Vídeo" no topo do seletor — só quando as duas abas
  // valem (pelo botão da barra). No "Adicionar…" do rodapé ela some.
  const kindSwitch =
    picker && !picker.only ? (
      <TransmitKindSwitch
        active={picker.active}
        onChange={(active) =>
          setPicker((current) =>
            current ? { ...current, active, only: false, switched: true } : current
          )
        }
      />
    ) : null

  let screen: React.JSX.Element

  if (checkingSession) {
    // Enquanto `session.load()` (IPC) não resolve, evita mostrar a tela
    // padrão em branco do Electron — usa o mesmo fundo/marca da tela de
    // login (item pedido pelo usuário) só com a logo centralizada.
    screen = (
      <div className="auth-page">
        <div className="auth-branding auth-branding-splash">
          <img src={iconName} alt="Prisma" />
          {/* Spinner (2026-09-13, pedido do usuário). O splash deixou de
              ser só uma marca parada: agora ele espera de verdade — o
              `session.load()` (que revalida o token no /me) e a abertura
              do WebSocket de salas. Sem um sinal de atividade, esse
              tempo pareceria travamento. */}
          <span className="splash-spinner" aria-label="Carregando" />
        </div>
      </div>
    )
  } else if (user) {
    // A Home fica SEMPRE montada aqui, e a tela de iniciar live entra
    // POR CIMA dela (2026-09-24, pedido do usuário). Antes as duas se
    // alternavam, e desmontar a Home jogava fora o DOM inteiro dela —
    // ao voltar, cada <img> de avatar era um elemento novo, que pisca
    // enquanto o Chromium resolve a imagem de novo (foi o que apareceu
    // como "avatares recarregando": o do próprio perfil no rodapé e o
    // da sala que estava ao vivo).
    //
    // O estado de sala/WebSocket nunca esteve nesse risco, porque mora
    // aqui no App e não na Home — o que se perdia era o estado LOCAL
    // dela (painel aberto, tile focado, rolagem) e o DOM.
    //
    // `.transmission-page` já era `position: fixed; inset: 0` com fundo
    // opaco, então ela cobre a Home sozinha; só precisou de um z-index
    // (ver main.css) pra ficar acima do conteúdo da Home.
    screen = (
      <>
        {/* `inert` enquanto o modal está aberto: sem isso o Tab passearia
            pela Home escondida atrás dele, e o leitor de tela leria as
            duas telas como se as duas estivessem visíveis. O <div> é
            permanente de propósito — envolver a Home só às vezes mudaria
            o tipo do nó e a desmontaria, que é justamente o que esta
            mudança evita. Ele não mexe no layout: `.home-page` é
            `position: fixed`, então não depende do pai pra se posicionar. */}
        <div inert={picker !== null}>
          <HomeScreen
            user={user}
            appVersion={appUpdate.currentVersion}
            onLogout={handleLogout}
            onUserUpdate={setUser}
            rooms={rooms}
            userAvatars={userAvatars}
            presence={presence}
            apiBaseUrl={apiBaseUrl}
            hiddenOwnRoomCode={hiddenOwnRoomCode}
            refreshingRooms={refreshingRooms}
            onRefreshRooms={refreshRooms}
            chatRooms={chat.rooms}
            onSendChat={chat.send}
            onChatRead={chat.markRead}
            onSetChatMuted={chat.setMuted}
            viewerRoomCodes={viewer.roomCodes}
            popinRoomCode={popinRoomCode}
            onPopinRoom={(code) => setPopinRoomCode(code)}
            onJoinRoom={(code, password, hidden) => {
              esquecerPopin(code)
              // Sem escolha explícita (clique na sala da barra, entrar por
              // código), entra no que a sala transmite AGORA — o que o
              // host ligar depois fica fechado até o "Assistir".
              const room = rooms.find((r) => r.name === code)
              return viewer.joinRoom(code, user.name, password, hidden ?? absentFeeds(room))
            }}
            onLeaveRoom={(code) => {
              esquecerPopin(code)
              viewer.leaveRoom(code)
            }}
            getAttachViewerVideo={viewer.getAttachVideo}
            getAttachViewerAudioContainer={viewer.getAttachAudioContainer}
            viewerAudioSettings={viewer.audioSettings}
            onSetViewerVolume={viewer.setVolume}
            onSetViewerMuted={viewer.setMuted}
            getViewerStatsFetcher={viewer.getStatsFetcher}
            getViewerBitrateFetcher={viewer.getBitrateFetcher}
            getAttachViewerCamVideo={viewer.getAttachCamVideo}
            viewerHiddenFeeds={viewer.hiddenFeeds}
            onSetViewerFeedVisible={viewer.setFeedVisible}
            onOpenPicker={(only) =>
              setPicker({
                active: only ?? 'screen',
                only: only !== undefined,
                switched: false,
                isPrivate: false
              })
            }
            webcamStatus={webcam.status}
            onStopWebcam={() => void stopWebcam()}
            transmitting={transmission.transmitting}
            launchingTransmission={transmission.launching}
            stoppingTransmission={transmission.stopping}
            // A SALA do host (2026-10-20, etapa 4): aberta pela tela, pela
            // webcam ou pelas duas — o rodapé, o chat e os espectadores são
            // dela, não de uma transmissão.
            roomCode={hostRoomCode}
            webcamDeviceName={webcam.device?.name ?? null}
            webcamStartedAt={webcam.startedAt}
            attachWebcamPreviewVideo={webcamPreview.attachVideo}
            transmissionStartedAt={transmission.startedAt}
            nowPlaying={transmission.nowPlaying}
            transmissionSettings={transmission.settings}
            onNotify={(message, isError, options) =>
              snackbar.show(message, { error: isError, ...options })
            }
            onStopTransmission={stopTransmission}
            onUpdateTransmission={transmission.update}
            hostPreviewEnabled={hostPreview.enabled}
            onToggleHostPreview={hostPreview.toggle}
            attachHostPreviewVideo={hostPreview.attachVideo}
            getHostPreviewStats={hostPreview.getStats}
            getHostPreviewBitrate={hostPreview.getBitrate}
          />
        </div>

        {picker?.active === 'screen' && (
          // O dialog de iniciar (2026-10-16): a tela cheia virou o mesmo
          // dialog do "atualizar", e o clique em "Compartilhar tela" já é
          // o início. Ele fecha NA HORA — a live aparece pro host no mesmo
          // render e o resto sobe em segundo plano (ver start() em
          // useGstreamerTransmission.ts).
          //
          // A qualidade só é lembrada quando a live entrou no ar de
          // verdade (2026-09-25): uma tentativa que falhou não "usou"
          // nada.
          //
          // Com a webcam no ar (2026-10-20), a tela entra na sala que ela
          // abriu: a privacidade é a da sala, e o switch aparece travado.
          <SourcePickerDialog
            mode="start"
            initialPrivate={currentHostRoom()?.private ?? picker.isPrivate}
            privateLocked={currentHostRoom() !== null}
            onPrivateChange={setPickerPrivate}
            instant={picker.switched}
            kindSwitch={kindSwitch}
            onClose={() => setPicker(null)}
            onPick={(settings, source) => {
              setPicker(null)
              void transmission
                .start(settings, user.name, nowPlayingFromSource(source))
                .then((started) => {
                  if (started)
                    saveLastQuality({ resolution: settings.resolution, fps: settings.fps })
                })
            }}
          />
        )}

        {/* A janela da webcam (2026-10-20, item 26). Com a tela no ar, a
            webcam entra na sala dela, com a privacidade travada. */}
        {picker?.active === 'cam' && (
          <WebcamPickerDialog
            instant={picker.switched}
            kindSwitch={kindSwitch}
            lockedPrivate={currentHostRoom()?.private ?? null}
            initialPrivate={picker.isPrivate}
            onPrivateChange={setPickerPrivate}
            onClose={() => setPicker(null)}
            onPick={(device, isPrivate) => {
              setPicker(null)
              void webcam.start(device, user.name, isPrivate)
            }}
          />
        )}
      </>
    )
  } else if (authScreen === 'register') {
    screen = (
      <RegisterScreen onAuthenticated={setUser} onNavigateLogin={() => setAuthScreen('login')} />
    )
  } else if (authScreen === 'forgot') {
    screen = (
      <ForgotPasswordScreen
        onNavigateLogin={() => setAuthScreen('login')}
        onNotify={(message) => snackbar.show(message)}
      />
    )
  } else {
    screen = (
      <LoginScreen
        onAuthenticated={setUser}
        onLoadRooms={loadRooms}
        onNavigateRegister={() => setAuthScreen('register')}
        onNavigateForgotPassword={() => setAuthScreen('forgot')}
      />
    )
  }

  return (
    <>
      {/* Conteúdo da titlebar (arte + versão) só nas telas de DENTRO do
          app: Home e iniciar live. No splash e no login/cadastro a faixa
          fica vazia — a arte sairia duplicada, porque essas telas já
          mostram a mesma no meio. `user` só é verdadeiro depois da sessão
          resolver, então ele sozinho já distingue os dois grupos. */}
      <TitleBar
        showContent={Boolean(user)}
        updateVersion={appUpdate.updateInfo?.version ?? null}
        onUpdateClick={appUpdate.openDialog}
        onNotesClick={releaseNotes.open}
      />
      {screen}
      {/* A janelinha vive fora de qualquer tela: ela sobrevive a
          navegar pra "iniciar live" e à janela principal ser
          minimizada — que é justamente quando ela mais serve. */}
      {popinRoomCode && (
        <PopinPlayer
          // A ficha da sala vem da lista em tempo real, mas quem decide
          // se a janelinha EXISTE é `popinRoomCode` (que segue
          // `viewer.roomCodes`, a conexão de verdade). Se fosse a lista,
          // um piscar dela — que acontece, ver useHiddenOwnRoomCode.ts —
          // fecharia a janela de uma live que está tocando.
          hostName={popinRoom?.hostName ?? '???'}
          participants={popinRoom?.participants.filter((p) => p !== popinRoom.hostName) ?? []}
          volume={popinAudio.volume}
          muted={popinAudio.muted}
          onSetVolume={(volume) => viewer.setVolume(popinRoomCode, volume)}
          onSetMuted={(muted) => viewer.setMuted(popinRoomCode, muted)}
          onLeave={() => {
            // Sair da SALA: a janelinha fecha junto (o componente
            // desmonta), e o app NÃO é trazido pra frente.
            setPopinRoomCode(null)
            viewer.leaveRoom(popinRoomCode)
          }}
          onExpand={() => {
            setPopinRoomCode(null)
            window.api.popin.restoreApp()
          }}
          onClosedExternally={() => setPopinRoomCode(null)}
          onFailed={() => {
            setPopinRoomCode(null)
            snackbar.show('Não foi possível abrir o mini player', { error: true })
          }}
          attachVideo={viewer.getAttachVideo(popinRoomCode)}
          attachAudioContainer={viewer.getAttachAudioContainer(popinRoomCode)}
        />
      )}

      <Snackbar message={snackbar.message} isError={snackbar.isError} onClose={snackbar.hide} />
      {/* As duas condições dizem coisas diferentes desde 2026-09-20:
          `updateInfo` é "existe atualização" (o que acende o botão da
          titlebar) e `dialogOpen` é "o diálogo está na tela". Recusar
          fecha só o segundo. Ver useAppUpdate.ts. */}
      {/* Notas da atualização (2026-09-25). Abre sozinha uma vez por
          versão nova e pelo link da titlebar — ver useReleaseNotes.ts. */}
      {releaseNotes.isOpen && (
        <ReleaseNotesModal
          initialVersion={releaseNotes.initialVersion}
          installedVersion={releaseNotes.installedVersion}
          newVersions={releaseNotes.newVersions}
          onClose={releaseNotes.close}
        />
      )}
      {appUpdate.updateInfo && appUpdate.dialogOpen && (
        <UpdateDialog
          currentVersion={appUpdate.currentVersion}
          newVersion={appUpdate.updateInfo.version}
          stage={appUpdate.stage}
          progress={appUpdate.progress}
          error={appUpdate.error}
          canDismiss={appUpdate.canDismiss}
          required={appUpdate.required}
          // Instalar fecha o app, e fechar o app derruba a live — agora
          // que dá pra chamar este diálogo NO MEIO de uma transmissão
          // (pelo botão da titlebar), ele precisa dizer isso antes.
          transmitting={anyTransmission}
          onStart={appUpdate.startUpdate}
          onCancelDownload={appUpdate.cancelDownload}
          onDismiss={appUpdate.dismiss}
        />
      )}
      {closingApp && (
        <div className="modal-backdrop">
          <div className="update-dialog">
            <span className="update-dialog-spinner" />
            <p className="update-dialog-status">Parando transmissão...</p>
          </div>
        </div>
      )}
    </>
  )
}

export default App
