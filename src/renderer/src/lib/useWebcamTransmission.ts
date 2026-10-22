import { useEffect, useRef, useState } from 'react'
import { getErrorMessage } from './errors'
import { playSound } from './sounds'
import { claimHostRoom, releaseHostRoom, teardownTransmission } from './hostRoom'

// A TRANSMISSÃO DA WEBCAM (2026-10-20, item 26 do roadmap)
//
// Separada da tela de propósito (decisão do usuário): botão próprio,
// janela própria, processo próprio. As duas só dividem a SALA — quem abre
// primeiro cria, a outra se vincula (ver hostRoom.ts). Desligar a webcam
// com a tela no ar não derruba a live, e vice-versa.
//
// O desenho segue o da tela (useGstreamerTransmission.ts) no que importa:
// a webcam aparece pro host NO CLIQUE, a sala e o processo sobem em
// segundo plano, e todo caminho de falha derruba o que já subiu. Fica de
// fora o que a câmera não tem: troca de fonte no meio, detecção de jogo,
// seguir janela.

export interface WebcamDevice {
  // O `deviceId` do Chromium — só serve pro preview na janela de escolha.
  id: string
  // O nome como o Windows o chama, que é o que o GStreamer entende.
  name: string
}

export type WebcamStatus = 'idle' | 'starting' | 'live' | 'stopping'

interface UseWebcamTransmissionResult {
  status: WebcamStatus
  // No ar ou subindo — o botão e o rodapé tratam os dois como "ligada".
  active: boolean
  roomCode: string | null
  // A sala já existe no servidor (o `createIngress` respondeu) — antes
  // disso o preview do rodapé não tem onde entrar. Mesmo papel do
  // `roomOpen` da tela.
  roomOpen: boolean
  device: WebcamDevice | null
  startedAt: number | null
  start: (device: WebcamDevice, participantName: string, isPrivate: boolean) => Promise<boolean>
  stop: () => Promise<void>
}

// O mesmo teto da tela: o pipeline da webcam ainda sonda a câmera antes
// (ver webcamCapture.ts), então leva um pouco mais — mas o que passa
// disso não é lentidão.
const PIPELINE_TIMEOUT_MS = 25000

export function useWebcamTransmission(
  onError?: (message: string) => void
): UseWebcamTransmissionResult {
  const [status, setStatus] = useState<WebcamStatus>('idle')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [roomOpen, setRoomOpen] = useState(false)
  const [device, setDevice] = useState<WebcamDevice | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  // Refs pelo mesmo motivo da tela: os handlers do main montam UMA vez e
  // precisam do valor do momento em que o evento chega, e um segundo
  // clique pode chegar antes do render que atualiza o estado.
  const activeRef = useRef(false)
  const roomCodeRef = useRef<string | null>(null)
  const expectingStopRef = useRef(false)
  const abortStartRef = useRef(false)
  const launchRef = useRef<Promise<unknown> | null>(null)
  const esperaRef = useRef<((ok: boolean) => void) | null>(null)

  function resolverEspera(ok: boolean): void {
    const settle = esperaRef.current
    if (!settle) return
    esperaRef.current = null
    settle(ok)
  }

  function resetLocalState(): void {
    activeRef.current = false
    roomCodeRef.current = null
    setStatus('idle')
    setRoomCode(null)
    setRoomOpen(false)
    setDevice(null)
    setStartedAt(null)
  }

  useEffect(() => window.api.webcam.onPlaying(() => resolverEspera(true)), [])

  // A webcam morreu sozinha: câmera desconectada, outro programa tomou a
  // câmera, ou o WHIP caiu. Derruba o ingress dela (e a sala, se era a
  // última) e avisa — mesmo papel do `onExited` da tela.
  useEffect(() => {
    return window.api.webcam.onExited((info) => {
      const code = roomCodeRef.current
      const wasExpected = expectingStopRef.current
      expectingStopRef.current = false
      resolverEspera(false)
      if (wasExpected) return

      const message = info.error ?? 'A webcam parou de transmitir inesperadamente.'
      onError?.(message)
      const { lastOne } = releaseHostRoom('cam')
      resetLocalState()
      if (code) void teardownTransmission(code, 'cam', lastOne)
    })
    // `onError` fica de fora pelo mesmo motivo do `onStartError` da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function esperarPipeline(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolverEspera(true), PIPELINE_TIMEOUT_MS)
      esperaRef.current = (ok) => {
        clearTimeout(timer)
        resolve(ok)
      }
    })
  }

  async function start(
    newDevice: WebcamDevice,
    participantName: string,
    isPrivate: boolean
  ): Promise<boolean> {
    if (activeRef.current) return false
    activeRef.current = true
    abortStartRef.current = false
    expectingStopRef.current = false

    const { code, attaching } = claimHostRoom('cam', isPrivate)
    roomCodeRef.current = code

    // A webcam existe pro host no clique, como a tela.
    setRoomCode(code)
    setDevice(newDevice)
    setStatus('starting')
    setStartedAt(Date.now())
    // O som de "live no ar" só quando a webcam ABRE a sala — com a tela
    // no ar, a live já existe e o som seria repetido.
    if (!attaching) playSound('newLive')

    function falhar(message: string): void {
      onError?.(message)
      const { lastOne } = releaseHostRoom('cam')
      resetLocalState()
      void teardownTransmission(code, 'cam', lastOne)
    }

    type Launch =
      { status: 'launched'; pronto: Promise<boolean> } | { status: 'aborted' | 'failed' }
    const launch = (async (): Promise<Launch> => {
      try {
        const { url, streamKey } = await window.api.livekit.createIngress({
          roomName: code,
          participantName,
          private: isPrivate,
          source: 'cam'
        })
        if (abortStartRef.current) return { status: 'aborted' }
        setRoomOpen(true)

        const pronto = esperarPipeline()
        const result = await window.api.webcam.start({
          roomCode: code,
          whipUrl: url,
          streamKey,
          deviceName: newDevice.name
        })
        if (!result.ok) {
          resolverEspera(false)
          falhar(result.error ?? 'Não foi possível iniciar a webcam.')
          return { status: 'failed' }
        }
        return { status: 'launched', pronto }
      } catch (err) {
        resolverEspera(false)
        if (abortStartRef.current) return { status: 'aborted' }
        falhar(getErrorMessage(err, 'Não foi possível iniciar a webcam.'))
        return { status: 'failed' }
      }
    })()
    launchRef.current = launch

    const launched = await launch
    if (launchRef.current === launch) launchRef.current = null
    if (launched.status !== 'launched') return false

    const ok = await launched.pronto
    if (!ok) return false
    if (activeRef.current) setStatus('live')
    return true
  }

  async function stop(): Promise<void> {
    const code = roomCodeRef.current
    expectingStopRef.current = true
    abortStartRef.current = true
    setStatus('stopping')

    // Parar no meio do início: espera o processo nascer (ou desistir)
    // antes de matar, pelo mesmo motivo da tela.
    if (launchRef.current) await launchRef.current.catch(() => undefined)

    await window.api.webcam.stop()
    const { lastOne } = releaseHostRoom('cam')
    if (code) await teardownTransmission(code, 'cam', lastOne)

    resetLocalState()
    if (lastOne) playSound('stopLive')
  }

  return {
    status,
    active: status === 'starting' || status === 'live',
    roomCode,
    roomOpen,
    device,
    startedAt,
    start,
    stop
  }
}
