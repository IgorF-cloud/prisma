import { useCallback, useEffect, useRef, useState } from 'react'
import { DisconnectReason, RemoteTrack, Room, RoomEvent, Track } from 'livekit-client'
import { RawTrackStats, readVideoReceiverStats } from './useTrackStats'
import { getErrorMessage } from './errors'
import { loadLastViewerVolume, saveLastViewerVolume } from './lastViewerVolume'
import { playSound } from './sounds'

interface ViewerConnection {
  room: Room
  // Tracks/elementos guardados aqui (não em refs individuais) porque cada
  // sala assistida tem sua própria conexão independente — precisa
  // reanexar a track certa no elemento certo quando ele (re)monta, mesmo
  // padrão do bug corrigido antes (navegar pra TransmissionScreen e
  // voltar desmonta/remonta os <video> da HomeScreen).
  videoTrack: RemoteTrack | null
  audioTrack: RemoteTrack | null
  videoElement: HTMLVideoElement | null
  audioContainer: HTMLDivElement | null
  // <audio> criado pelo track.attach() — guardado pra poder ajustar
  // volume/mute sem precisar recriar o elemento. `volume`/`muted` são a
  // fonte de verdade (o elemento pode nem existir ainda quando o slider é
  // mexido, se a track de áudio ainda não chegou).
  audioElement: HTMLAudioElement | null
  volume: number
  muted: boolean
  // Pedido do usuário: o áudio chegava/tocava antes do primeiro frame de
  // vídeo (a Home mostra "Aguardando transmissão" enquanto isso) — sem
  // isso, dava pra OUVIR a live antes de VER ela. Começa sempre mutado
  // de verdade (independente de `muted` acima, que é só a preferência do
  // usuário) até o vídeo ter conteúdo, ver markVideoReady().
  videoReady: boolean
  // O `loadeddata` armado no <video> que ainda espera o primeiro quadro —
  // guardado pra não empilhar dois no mesmo elemento. Ver `attachVideo`.
  videoReadyListener: { element: HTMLVideoElement; listener: () => void } | null
}

export interface ViewerAudioState {
  volume: number
  muted: boolean
}

interface UseViewerResult {
  // Item 23 do roadmap: assistir várias lives ao mesmo tempo — uma
  // conexão independente por código de sala, todas simultâneas.
  roomCodes: string[]
  // Item novo (2026-09-04, "sala com senha"): `password` só importa
  // quando a sala tem uma (ver RoomInfo.hasPassword) — devolve `error`
  // (ex: "Senha incorreta.", vindo direto do server.js) além do
  // `onError` de sempre (snackbar), pra quem chamou (o modal de senha,
  // ver HomeScreen.tsx) poder mostrar o motivo específico inline.
  joinRoom: (
    roomCode: string,
    participantName: string,
    password?: string
  ) => Promise<{ ok: boolean; error?: string }>
  // `silent` é pra saídas em lote que não são "eu saí desta live" (ex:
  // logout derrubando todas as salas de uma vez — tocaria um 'viewerOut'
  // por sala, empilhados).
  leaveRoom: (roomCode: string, options?: { silent?: boolean }) => void
  // ref callback pro <video> de uma sala específica — uma por tile.
  getAttachVideo: (roomCode: string) => (element: HTMLVideoElement | null) => void
  // ref callback pro <div> escondido que hospeda o <audio> de uma sala
  // específica (o livekit-client cria o elemento de áudio sozinho — sem
  // estar no DOM, o áudio não toca).
  getAttachAudioContainer: (roomCode: string) => (element: HTMLDivElement | null) => void
  // Volume/mute por live assistida (nunca se aplica ao preview do
  // próprio host — esse usa <video muted> direto, nem passa por aqui).
  // `audioSettings` é só leitura pra UI (slider/ícone); os setters
  // empurram o valor pro <audio> de verdade também.
  audioSettings: Record<string, ViewerAudioState>
  setVolume: (roomCode: string, volume: number) => void
  setMuted: (roomCode: string, muted: boolean) => void
  // Item 26 do roadmap: estatísticas em tempo real (codec/resolução/fps/
  // bitrate/perda) de uma live assistida — funções cacheadas por sala,
  // mesmo padrão de getAttachVideo/getAttachAudioContainer acima, pra
  // passar pro useTrackStats.ts com identidade estável entre renders.
  getStatsFetcher: (roomCode: string) => () => Promise<RawTrackStats | undefined>
  getBitrateFetcher: (roomCode: string) => () => number
}

// onEndedByHost (item 14): chamado quando alguma conexão cai porque o HOST
// dela encerrou a live de propósito (sala derrubada no servidor, ver
// DELETE /rooms/:roomName no token-server) — não quando o próprio viewer
// clica em "Sair da sala". A tela volta sozinha pro estado padrão de
// qualquer forma (leaveRoom() sempre roda); esse callback é só pro aviso
// (snackbar "Transmissão encerrada" em App.tsx).
//
// Recebe o MOTIVO desde 2026-09-13, quando o host ganhou o "Expulsar":
// ser removido da sala também cai aqui, e avisar "Transmissão
// encerrada" pra quem foi expulso seria simplesmente falso — a live
// continua no ar pra todo mundo menos pra ele.
//
// onError: falha ao entrar numa sala (ex: sala não existe mais) — pedido
// do usuário pra virar um snackbar de erro em vez de texto fixo na tela,
// então esse hook não guarda mais o erro em estado próprio, só repassa.
export function useViewer(
  onEndedByHost?: (reason: 'ended' | 'removed') => void,
  onError?: (message: string) => void
): UseViewerResult {
  // Map em ref (não em estado) porque guarda objetos "vivos" (Room,
  // elementos DOM) que não devem disparar re-render sozinhos — quem
  // dispara re-render é `roomCodes` (só os dados que a UI realmente
  // precisa pra desenhar a tela).
  const connectionsRef = useRef<Map<string, ViewerConnection>>(new Map())
  // Uma ref callback por sala, cacheada — sem isso, uma nova função a
  // cada render faria o React desanexar/reanexar o elemento à toa.
  const videoCallbacksRef = useRef<Map<string, (element: HTMLVideoElement | null) => void>>(
    new Map()
  )
  const audioCallbacksRef = useRef<Map<string, (element: HTMLDivElement | null) => void>>(new Map())
  const statsFetcherCacheRef = useRef<Map<string, () => Promise<RawTrackStats | undefined>>>(
    new Map()
  )
  const bitrateFetcherCacheRef = useRef<Map<string, () => number>>(new Map())
  const [roomCodes, setRoomCodes] = useState<string[]>([])
  const [audioSettings, setAudioSettings] = useState<Record<string, ViewerAudioState>>({})

  // Chamado tanto no handler de TrackSubscribed quanto na ref callback do
  // container — qualquer um dos dois pode "chegar por último" (a track
  // pode ser assinada antes ou depois do elemento montar). Idempotente:
  // só cria o <audio> na primeira vez que os dois já existem, nunca de
  // novo — chamar track.attach() duas vezes pra mesma conexão criaria um
  // segundo elemento de áudio órfão, tocando sem responder ao volume/mute.
  function ensureAudioAttached(connection: ViewerConnection): void {
    if (connection.audioElement || !connection.audioContainer || !connection.audioTrack) return
    const el = connection.audioTrack.attach()
    el.volume = connection.volume
    // Força mudo até o vídeo ter conteúdo, mesmo que a preferência do
    // usuário (`connection.muted`) seja "com som" — ver markVideoReady().
    el.muted = connection.videoReady ? connection.muted : true
    connection.audioElement = el
    connection.audioContainer.appendChild(el)
  }

  // Chamado no primeiro 'loadeddata' do <video> dessa conexão (ver
  // getAttachVideo abaixo) — só então aplica o volume/mudo de verdade que
  // o usuário escolheu (ou o padrão "com som", ver joinRoom). `{ once:
  // true }` no addEventListener já garante que só roda uma vez.
  function markVideoReady(connection: ViewerConnection): void {
    connection.videoReady = true
    connection.videoReadyListener = null
    if (connection.audioElement) {
      connection.audioElement.muted = connection.muted
      connection.audioElement.volume = connection.volume
    }
  }

  // Liga a track de vídeo ao <video> e, se ainda não houve quadro, arma o
  // aviso do primeiro (`loadeddata` -> markVideoReady).
  //
  // Bug real (2026-10-19, relatado pelo usuário: trocar a live de JANELA
  // pra TELA INTEIRA deixava o som "inaudível" pra quem assistia, até
  // parar e começar outra live). O aviso só era armado quando o <video>
  // MONTAVA. Numa troca de fonte o host sobe um pipeline novo, o viewer
  // recebe tracks NOVAS no mesmo <video>, `videoReady` volta a false e o
  // <audio> novo nasce mudo esperando o primeiro quadro — mas o
  // `loadeddata` com `once` já tinha sido gasto na track anterior, e
  // ninguém armava outro. O áudio ficava mudo pra sempre. Agora quem anexa
  // a track nova arma também, nos dois caminhos (track chegando, <video>
  // montando).
  function attachVideo(connection: ViewerConnection): void {
    const element = connection.videoElement
    if (!element || !connection.videoTrack) return
    connection.videoTrack.attach(element)
    if (connection.videoReady) return

    const armado = connection.videoReadyListener
    if (armado?.element === element) return
    if (armado) armado.element.removeEventListener('loadeddata', armado.listener)
    const listener = (): void => markVideoReady(connection)
    element.addEventListener('loadeddata', listener, { once: true })
    connection.videoReadyListener = { element, listener }
  }

  // Pedido do usuário (2026-10-19): como VIEWER, eu também ouço o
  // 'viewerOut' quando EU saio de uma live — o mesmo som que o host ouve
  // quando alguém sai da dele. Fica só aqui, na saída voluntária: quando
  // o host derruba a sala ou me expulsa, quem toca é o handler de
  // Disconnected (som 'stopLive'), que usa o teardown() direto.
  function leaveRoom(roomCode: string, options?: { silent?: boolean }): void {
    if (!connectionsRef.current.has(roomCode)) return
    teardown(roomCode)
    if (!options?.silent) playSound('viewerOut')
  }

  function teardown(roomCode: string): void {
    const connection = connectionsRef.current.get(roomCode)
    if (!connection) return

    connection.room.disconnect()
    if (connection.videoElement) connection.videoElement.srcObject = null
    if (connection.audioContainer) connection.audioContainer.innerHTML = ''

    connectionsRef.current.delete(roomCode)
    videoCallbacksRef.current.delete(roomCode)
    audioCallbacksRef.current.delete(roomCode)
    statsFetcherCacheRef.current.delete(roomCode)
    bitrateFetcherCacheRef.current.delete(roomCode)
    setRoomCodes((current) => current.filter((code) => code !== roomCode))
    setAudioSettings((current) => {
      const next = { ...current }
      delete next[roomCode]
      return next
    })
  }

  async function joinRoom(
    roomCode: string,
    participantName: string
  ): Promise<{ ok: boolean; error?: string }> {
    // Já assistindo essa sala — não faz nada (o botão na lista já mostra
    // "Assistindo" nesse caso, ver HomeScreen.tsx).
    if (connectionsRef.current.has(roomCode)) return { ok: true }

    try {
      const { token, wsUrl } = await window.api.livekit.getToken({
        roomName: roomCode,
        participantName,
        role: 'viewer'
        // Sem senha desde 2026-09-10: numa sala privada quem decide se
        // este token sai é a lista de convidados no servidor.
      })

      const room = new Room()
      // Lido AGORA (e não uma vez na montagem do hook) porque o valor
      // pode ter mudado desde então: mexer no volume de uma live que já
      // está tocando grava na hora, e é esse valor mais recente que a
      // live entrando agora deve herdar.
      const savedVolume = loadLastViewerVolume()
      const connection: ViewerConnection = {
        room,
        videoTrack: null,
        audioTrack: null,
        videoElement: null,
        audioContainer: null,
        audioElement: null,
        volume: savedVolume.volume,
        muted: savedVolume.muted,
        videoReady: false,
        videoReadyListener: null
      }

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video) {
          connection.videoTrack = track
          attachVideo(connection)
        } else if (track.kind === Track.Kind.Audio) {
          connection.audioTrack = track
          ensureAudioAttached(connection)
        }
      })

      // Bug real (2026-09-03): item 13 do roadmap ("Atualizar
      // transmissão") mata o processo GStreamer antigo do host e sobe
      // um novo com os parâmetros novos — pro viewer, isso significa
      // que a track de ÁUDIO (e vídeo) antiga é ENCERRADA e uma NOVA é
      // publicada em seguida (outro TrackSubscribed acima, não é a
      // mesma track reaproveitada). Sem desanexar a antiga aqui,
      // `connection.audioElement` continuava apontando pro elemento
      // ligado à track MORTA — `ensureAudioAttached` usa a EXISTÊNCIA
      // desse elemento como sinal de "já anexado" (evita duplicar), então
      // nunca criava um novo pra track nova — o viewer ficava sem áudio
      // até sair da sala e entrar de novo (aí sim criava uma conexão do
      // zero). `videoReady` também volta a `false` no vídeo — a track
      // nova começa sem frame nenhum ainda, mesmo motivo de
      // markVideoReady() logo abaixo silenciar até o primeiro frame de
      // verdade chegar.
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && connection.audioTrack === track) {
          if (connection.audioElement) {
            track.detach(connection.audioElement)
            connection.audioElement = null
          }
          connection.audioTrack = null
        } else if (track.kind === Track.Kind.Video && connection.videoTrack === track) {
          if (connection.videoElement) track.detach(connection.videoElement)
          connection.videoTrack = null
          connection.videoReady = false
        }
      })

      room.on(RoomEvent.Disconnected, (reason) => {
        // teardown() e não leaveRoom(): o 'viewerOut' é só da saída
        // voluntária. Quando fui EU que saí, leaveRoom() já desmontou
        // tudo e isto aqui vira no-op.
        teardown(roomCode)
        // CLIENT_INITIATED é quando o próprio viewer chama .disconnect()
        // (botão "Sair da sala") — não avisa nesse caso, só quando a
        // desconexão veio de fora (sala derrubada pelo host).
        //
        // Pedido do usuário (2026-09-06): esse é o "stopLive" do lado de
        // quem ESTAVA assistindo — a chave 'kicked' (que apontava pro
        // mesmo arquivo do antigo 'out') deixou de existir; agora host e
        // viewers da sala derrubada ouvem literalmente o mesmo som.
        if (reason !== DisconnectReason.CLIENT_INITIATED) {
          onEndedByHost?.(reason === DisconnectReason.PARTICIPANT_REMOVED ? 'removed' : 'ended')
          playSound('stopLive')
        }
      })

      await room.connect(wsUrl, token)

      connectionsRef.current.set(roomCode, connection)
      setRoomCodes((current) => [...current, roomCode])
      setAudioSettings((current) => ({ ...current, [roomCode]: savedVolume }))
      // Pedido do usuário (2026-10-19): como VIEWER, eu também ouço o
      // 'newViewer' ao entrar numa live — toca só depois de conectar de
      // fato, então também serve de confirmação de que a entrada deu certo.
      playSound('newViewer')
      return { ok: true }
    } catch (err) {
      const message = getErrorMessage(err, 'Erro ao entrar na sala')
      onError?.(message)
      return { ok: false, error: message }
    }
  }

  const setVolume = useCallback((roomCode: string, volume: number) => {
    const connection = connectionsRef.current.get(roomCode)
    if (!connection) return
    // Zerar o slider muta também (pedido explícito do usuário); qualquer
    // valor acima de 0 desmuta — mesmo comportamento de players comuns
    // (mexer no volume enquanto mudo indica que quer ouvir de novo).
    const muted = volume === 0
    connection.volume = volume
    connection.muted = muted
    if (connection.audioElement) {
      connection.audioElement.volume = volume
      connection.audioElement.muted = muted
    }
    setAudioSettings((current) => ({ ...current, [roomCode]: { volume, muted } }))
    // Grava a cada mexida (e não só ao sair da live): o app pode ser
    // fechado com a live no ar, e volume não tem um "momento de
    // confirmar" como a qualidade da transmissão tem.
    saveLastViewerVolume({ volume, muted })
  }, [])

  const setMuted = useCallback((roomCode: string, muted: boolean) => {
    const connection = connectionsRef.current.get(roomCode)
    if (!connection) return
    connection.muted = muted
    if (connection.audioElement) connection.audioElement.muted = muted
    setAudioSettings((current) => ({
      ...current,
      [roomCode]: { volume: connection.volume, muted }
    }))
    saveLastViewerVolume({ volume: connection.volume, muted })
  }, [])

  const getAttachVideo = useCallback((roomCode: string) => {
    let callback = videoCallbacksRef.current.get(roomCode)
    if (!callback) {
      callback = (element: HTMLVideoElement | null) => {
        const connection = connectionsRef.current.get(roomCode)
        if (!connection) return
        // Bug real (2026-09-03): navegar pra TransmissionScreen desmonta a
        // HomeScreen inteira, incluindo esse <video> — sem desanexar a
        // track aqui, ela continuava decodificando pro elemento órfão (só
        // na memória, nunca mais visível) até a sala inteira desconectar.
        // Desanexar também limpa `videoReady`, senão o próximo <video> que
        // remontar herdaria esse estado do elemento antigo e nunca
        // agendaria o próprio listener de "loadeddata".
        if (!element && connection.videoElement && connection.videoTrack) {
          connection.videoTrack.detach(connection.videoElement)
          connection.videoReady = false
        }
        connection.videoElement = element
        // Reanexa se a track já tinha sido assinada antes desse elemento
        // existir (ex: HomeScreen remontou depois de navegar pra
        // TransmissionScreen e voltar).
        attachVideo(connection)
      }
      videoCallbacksRef.current.set(roomCode, callback)
    }
    return callback
  }, [])

  const getAttachAudioContainer = useCallback((roomCode: string) => {
    let callback = audioCallbacksRef.current.get(roomCode)
    if (!callback) {
      callback = (element: HTMLDivElement | null) => {
        const connection = connectionsRef.current.get(roomCode)
        if (!connection) return
        // Mesmo bug do vídeo acima, só que audível: um <audio> continua
        // TOCANDO mesmo depois de removido do DOM (o browser não pausa
        // sozinho só por isso) — sem desanexar aqui, a live assistida
        // ficava tocando escondida ao navegar pra outra tela, e só
        // sair+entrar de novo na sala resolvia (isso recriava a conexão
        // do zero). Zerar `audioElement` também é o que permite
        // `ensureAudioAttached` criar um elemento novo quando o container
        // remontar — antes ficava preso achando que já existia um
        // (o próprio órfão) e nunca reanexava.
        if (!element && connection.audioElement && connection.audioTrack) {
          connection.audioTrack.detach(connection.audioElement)
          connection.audioElement = null
        }
        connection.audioContainer = element
        ensureAudioAttached(connection)
      }
      audioCallbacksRef.current.set(roomCode, callback)
    }
    return callback
  }, [])

  const getStatsFetcher = useCallback((roomCode: string) => {
    let fetcher = statsFetcherCacheRef.current.get(roomCode)
    if (!fetcher) {
      fetcher = () => readVideoReceiverStats(connectionsRef.current.get(roomCode)?.videoTrack)
      statsFetcherCacheRef.current.set(roomCode, fetcher)
    }
    return fetcher
  }, [])

  const getBitrateFetcher = useCallback((roomCode: string) => {
    let fetcher = bitrateFetcherCacheRef.current.get(roomCode)
    if (!fetcher) {
      fetcher = () => connectionsRef.current.get(roomCode)?.videoTrack?.currentBitrate ?? 0
      bitrateFetcherCacheRef.current.set(roomCode, fetcher)
    }
    return fetcher
  }, [])

  // Garante que todas as conexões param se o app inteiro desmontar (não
  // deveria acontecer na prática, mas evita vazar recursos). `connections`
  // é o mesmo Map de connectionsRef.current (só copiado pra variável local
  // pro lint não reclamar de ler a ref no cleanup) — como o Map é mutado
  // no lugar, não reatribuído, continua valendo o conteúdo mais atual.
  useEffect(() => {
    const connections = connectionsRef.current
    return () => {
      connections.forEach((connection) => connection.room.disconnect())
    }
  }, [])

  return {
    roomCodes,
    joinRoom,
    leaveRoom,
    getAttachVideo,
    getAttachAudioContainer,
    audioSettings,
    setVolume,
    setMuted,
    getStatsFetcher,
    getBitrateFetcher
  }
}
