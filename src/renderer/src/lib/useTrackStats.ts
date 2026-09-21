import { useEffect, useRef, useState } from 'react'

// Item 26 do roadmap: formato comum o suficiente pra cobrir tanto
// VideoReceiverStats (viewer) quanto VideoSenderStats (host) do
// livekit-client — cada um só preenche os campos que tem (ex: viewer não
// tem framesPerSecond, host não tem mimeType/framesDecoded).
export interface RawTrackStats {
  mimeType?: string
  frameWidth?: number
  frameHeight?: number
  framesPerSecond?: number
  framesDecoded?: number
  packetsLost?: number
  jitter?: number
  timestamp: number
}

export interface DisplayStats {
  codec: string
  resolution: string
  fps: number
  bitrateKbps: number
  packetsLost: number
  jitterMs: number
}

const POLL_INTERVAL_MS = 2000

// Só ativa o polling enquanto `enabled` (o painel de estatísticas está
// aberto) — sem isso ficaria calculando à toa com a caixa fechada.
export function useTrackStats(
  enabled: boolean,
  fallbackCodec: string,
  fetchStats: () => Promise<RawTrackStats | undefined>,
  getBitrate: () => number
): DisplayStats | null {
  const [stats, setStats] = useState<DisplayStats | null>(null)
  const prevRef = useRef<RawTrackStats | null>(null)

  useEffect(() => {
    // Desligado: não faz nada (sem cleanup) — o estado já começa/volta a
    // `null` sozinho, via o cleanup do run ANTERIOR (que rodava com
    // enabled=true) quando `enabled` vira false, não aqui dentro (senão
    // seria "setState síncrono direto no corpo do efeito", bloqueado
    // pelo lint deste projeto).
    if (!enabled) return

    let cancelled = false

    async function poll(): Promise<void> {
      const raw = await fetchStats()
      if (cancelled || !raw) return

      // VideoSenderStats (host) já vem com framesPerSecond pronto;
      // VideoReceiverStats (viewer) não tem esse campo — calcula a
      // partir da diferença de frames decodificados entre duas leituras.
      let fps = raw.framesPerSecond ?? 0
      const prev = prevRef.current
      if (
        raw.framesPerSecond === undefined &&
        prev &&
        raw.framesDecoded !== undefined &&
        prev.framesDecoded !== undefined
      ) {
        const deltaFrames = raw.framesDecoded - prev.framesDecoded
        const deltaMs = raw.timestamp - prev.timestamp
        fps = deltaMs > 0 ? Math.round((deltaFrames / deltaMs) * 1000) : 0
      }
      prevRef.current = raw

      setStats({
        // mimeType (ex: "video/H264") só existe do lado do viewer — o
        // host usa o fallback fixo (sempre H264, é o que publicamos).
        codec: raw.mimeType ? raw.mimeType.replace(/^video\//, '').toUpperCase() : fallbackCodec,
        resolution:
          raw.frameWidth && raw.frameHeight ? `${raw.frameWidth}x${raw.frameHeight}` : '—',
        fps,
        bitrateKbps: Math.round(getBitrate() / 1000),
        packetsLost: raw.packetsLost ?? 0,
        jitterMs: Math.round((raw.jitter ?? 0) * 1000)
      })
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
      prevRef.current = null
      setStats(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  return stats
}
