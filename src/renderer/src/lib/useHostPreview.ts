import { useCallback, useEffect, useRef, useState } from 'react'
import { RemoteVideoTrack, Room, RoomEvent, Track } from 'livekit-client'
import { RawTrackStats, readVideoReceiverStats } from './useTrackStats'

interface UseHostPreviewResult {
  // Desabilitado por padrão (pedido explícito do usuário) — só conecta
  // de verdade quando ligado, ver useEffect abaixo.
  enabled: boolean
  toggle: () => void
  // Desliga o preview AGORA, sem esperar o ciclo de render do React
  // desmontar o efeito — usado antes de derrubar a sala (ver
  // `onStopTransmission` em App.tsx e o comentário do `reconnectPolicy`
  // abaixo pro bug que isso evita).
  disconnect: () => void
  attachVideo: (element: HTMLVideoElement | null) => void
  getStats: () => Promise<RawTrackStats | undefined>
  getBitrate: () => number
}

// Bug real de produção (2026-09-06): o preview é a conexão MAIS provável
// de recriar uma sala já apagada. Ao parar a live, a sala é derrubada
// enquanto o preview ainda está conectado (o cleanup do efeito só roda
// quando `roomCode` vira null, o que acontece DEPOIS do teardown) — e o
// livekit-client, ao ser desconectado, tenta reconectar sozinho com
// backoff. Como `auto_create` do LiveKit é true e o token continua
// válido por horas, essa reconexão RECRIA a sala, que volta pra lista de
// todo mundo como "Live de ???" (sem publisher nenhum).
//
// Aqui reconectar não tem valor nenhum: é o host vendo a PRÓPRIA live,
// local, e religar é um clique. `null` = não tenta de novo, nunca.
const NEVER_RECONNECT = { nextRetryDelayInMs: (): null => null }

// Item 15 do roadmap: preview da própria live pro HOST. O GStreamer roda
// como processo do SO separado do Electron (gst-launch-1.0.exe) — não
// tem NENHUM jeito de pegar os frames capturados de volta pro processo
// do Electron diretamente (sem memória/pipe compartilhado). A solução
// (mesma "gambiarra" que o app Flutter antigo já usava, ver
// _connectSelfPreview em home_screen.dart): o host entra na PRÓPRIA sala
// como um segundo participante, só que:
//   - identity com sufixo "-preview" (diferente da identity que publica
//     via Ingress — usar a mesma identity derrubaria a publicação, já
//     que o LiveKit não permite duas conexões com a mesma identity na
//     mesma sala).
//   - grant "hidden" do LiveKit (participante não conta em
//     numParticipants nem aparece pra mais ninguém — token-server
//     precisa aceitar `hidden=true` no `/token`, ver src/main/livekit.ts).
//   - `autoSubscribe: false` no connect + assina manualmente só a track
//     de VÍDEO do host de verdade — nunca a de áudio (senão o host
//     ouviria o próprio jogo/mic com o atraso da volta completa
//     captura→encode→WHIP→SFU→decode, um eco bem perceptível).
//
// Diferente de useViewer.ts (conexão fica viva o tempo todo, indo/vindo
// de outras telas): aqui só CONECTA quando o preview é ligado, e
// desconecta completamente quando é desligado — mais simples, e como o
// preview vem desabilitado por padrão, na maior parte do tempo essa
// conexão nem existe.
//
// A WEBCAM (2026-10-20, item 26, etapa 4): o mesmo truque, numa segunda
// conexão. `feed: 'cam'` assina o vídeo de `<host>-cam` (a identity da
// webcam no servidor) e entra como `<host>-cam-preview` — termina em
// "-preview", então o servidor já a trata como oculta, e não termina em
// "-cam", que o `/token` recusa. Duas conexões e não uma porque cada
// preview liga e desliga sozinho, junto com a SUA transmissão.
//
// `alwaysOn`: a miniatura do cartão da webcam no rodapé não tem botão —
// existe enquanto a webcam estiver no ar. O toggle continua existindo,
// só não manda.
export function useHostPreview(
  roomCode: string | null,
  hostIdentity: string | null,
  { feed = 'screen', alwaysOn = false }: { feed?: 'screen' | 'cam'; alwaysOn?: boolean } = {}
): UseHostPreviewResult {
  const [toggled, setEnabled] = useState(false)
  const enabled = alwaysOn || toggled
  const targetIdentity = hostIdentity && feed === 'cam' ? `${hostIdentity}-cam` : hostIdentity
  const videoTrackRef = useRef<RemoteVideoTrack | null>(null)
  const videoElementRef = useRef<HTMLVideoElement | null>(null)
  // Só pro `disconnect()` abaixo alcançar a conexão viva de fora do
  // efeito — quem cria/destrói a Room continua sendo o próprio efeito.
  const roomRef = useRef<Room | null>(null)

  // Se a sala sumir (transmissão parou) enquanto o preview está ligado,
  // ou o componente desmontar, o cleanup abaixo desconecta E desliga o
  // toggle — sem isso, religar uma transmissão nova deixaria o preview
  // "ligado" sozinho sem o usuário ter pedido de novo.
  useEffect(() => {
    if (!enabled || !roomCode || !targetIdentity) return

    let cancelled = false
    const room = new Room({ reconnectPolicy: NEVER_RECONNECT })
    roomRef.current = room

    function subscribeHostVideo(): void {
      for (const participant of room.remoteParticipants.values()) {
        if (participant.identity !== targetIdentity) continue
        for (const publication of participant.videoTrackPublications.values()) {
          publication.setSubscribed(true)
        }
      }
    }

    room.on(RoomEvent.TrackPublished, (_publication, participant) => {
      if (participant.identity === targetIdentity) subscribeHostVideo()
    })
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (participant.identity !== targetIdentity || track.kind !== Track.Kind.Video) return
      videoTrackRef.current = track as RemoteVideoTrack
      if (videoElementRef.current) track.attach(videoElementRef.current)
    })
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Video) videoTrackRef.current = null
    })

    // Sem isso (2026-09-06), a sala derrubada do outro lado (fim da live,
    // ou o teardown de sala sem host do server.js) deixava o toggle
    // ligado apontando pra uma conexão morta — o tile ficava preso em
    // "Aguardando transmissão" pra sempre. Com `NEVER_RECONNECT` acima,
    // esse evento é definitivo: não há retry em andamento pra esperar.
    room.on(RoomEvent.Disconnected, () => {
      videoTrackRef.current = null
      setEnabled(false)
    })

    async function connect(): Promise<void> {
      const { token, wsUrl } = await window.api.livekit.getToken({
        roomName: roomCode as string,
        participantName: `${targetIdentity}-preview`,
        role: 'viewer',
        hidden: true
      })
      if (cancelled) return

      await room.connect(wsUrl, token, { autoSubscribe: false })
      if (cancelled) {
        room.disconnect()
        return
      }
      subscribeHostVideo()
    }

    connect().catch((err) => {
      console.error('Erro ao conectar preview do host:', err)
    })

    return () => {
      cancelled = true
      room.disconnect()
      if (roomRef.current === room) roomRef.current = null
      videoTrackRef.current = null
      if (videoElementRef.current) videoElementRef.current.srcObject = null
      setEnabled(false)
    }
  }, [enabled, roomCode, targetIdentity])

  // Desconecta na hora, sem depender do cleanup do efeito (que só roda no
  // próximo render). Chamado antes de derrubar a sala — ver
  // `onStopTransmission` em App.tsx.
  const disconnect = useCallback(() => {
    roomRef.current?.disconnect()
    roomRef.current = null
    videoTrackRef.current = null
    setEnabled(false)
  }, [])

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoElementRef.current = element
    if (element && videoTrackRef.current) videoTrackRef.current.attach(element)
  }, [])

  const getStats = useCallback(async (): Promise<RawTrackStats | undefined> => {
    return readVideoReceiverStats(videoTrackRef.current)
  }, [])

  const getBitrate = useCallback((): number => {
    return videoTrackRef.current?.currentBitrate ?? 0
  }, [])

  function toggle(): void {
    setEnabled((current) => !current)
  }

  return { enabled, toggle, disconnect, attachVideo, getStats, getBitrate }
}
