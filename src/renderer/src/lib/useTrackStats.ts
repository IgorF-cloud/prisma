import { useEffect, useRef, useState } from 'react'
import type { RemoteTrack } from 'livekit-client'

// Item 26 do roadmap. Desde 2026-10-16 sai direto do `inbound-rtp` do
// WebRTC (ver readVideoReceiverStats abaixo), não mais do
// `getReceiverStats()` do livekit-client — esse não traz as travadas
// (freezeCount) nem o quanto de buffer o player está segurando, que são
// justamente os números que dizem se o problema é a rede ou este PC.
// Todos os contadores são ACUMULADOS desde que a track foi assinada.
export interface RawTrackStats {
  mimeType?: string
  frameWidth?: number
  frameHeight?: number
  framesPerSecond?: number
  framesDecoded?: number
  framesDropped?: number
  packetsLost?: number
  packetsReceived?: number
  bytesReceived?: number
  jitter?: number
  jitterBufferDelay?: number
  jitterBufferEmittedCount?: number
  freezeCount?: number
  totalFreezesDuration?: number
  nackCount?: number
  pliCount?: number
  timestamp: number
}

export interface DisplayStats {
  codec: string
  resolution: string
  fps: number
  bitrateKbps: number
  // Perda dos últimos 2s (o intervalo do polling), em %, e o total de
  // pacotes perdidos desde o começo.
  lossPercent: number
  packetsLost: number
  jitterMs: number
  // Quanto o player está segurando antes de mostrar o quadro, em média,
  // nos últimos 2s (o buffer que o próprio navegador ajusta sozinho).
  bufferMs: number
  framesDropped: number
  freezes: number
  freezeSeconds: number
  nackCount: number
  pliCount: number
}

const POLL_INTERVAL_MS = 2000

// O `inbound-rtp` de vídeo da track, já com o codec resolvido (o report
// só traz um `codecId` apontando pra outra entrada).
export async function readVideoReceiverStats(
  track: RemoteTrack | null | undefined
): Promise<RawTrackStats | undefined> {
  const report = await track?.getRTCStatsReport()
  if (!report) return undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inbound: any
  report.forEach((stat) => {
    if (stat.type === 'inbound-rtp' && stat.kind === 'video') inbound = stat
  })
  if (!inbound) return undefined

  return {
    mimeType: inbound.codecId ? report.get(inbound.codecId)?.mimeType : undefined,
    frameWidth: inbound.frameWidth,
    frameHeight: inbound.frameHeight,
    framesPerSecond: inbound.framesPerSecond,
    framesDecoded: inbound.framesDecoded,
    framesDropped: inbound.framesDropped,
    packetsLost: inbound.packetsLost,
    packetsReceived: inbound.packetsReceived,
    bytesReceived: inbound.bytesReceived,
    jitter: inbound.jitter,
    jitterBufferDelay: inbound.jitterBufferDelay,
    jitterBufferEmittedCount: inbound.jitterBufferEmittedCount,
    freezeCount: inbound.freezeCount,
    totalFreezesDuration: inbound.totalFreezesDuration,
    nackCount: inbound.nackCount,
    pliCount: inbound.pliCount,
    timestamp: inbound.timestamp
  }
}

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

      const prev = prevRef.current
      prevRef.current = raw
      const deltaMs = prev ? raw.timestamp - prev.timestamp : 0
      // Diferença de um contador acumulado desde a leitura anterior. Na
      // primeira leitura (ou se a track trocou e o contador recomeçou)
      // não há intervalo pra medir — devolve undefined e quem usa cai no
      // fallback.
      function delta(key: Exclude<keyof RawTrackStats, 'mimeType'>): number | undefined {
        const current = raw?.[key]
        const before = prev?.[key]
        if (current === undefined || before === undefined || deltaMs <= 0) return undefined
        return current >= before ? current - before : undefined
      }

      let fps = raw.framesPerSecond ?? 0
      const deltaFrames = delta('framesDecoded')
      if (raw.framesPerSecond === undefined && deltaFrames !== undefined) {
        fps = Math.round((deltaFrames / deltaMs) * 1000)
      }

      const deltaBytes = delta('bytesReceived')
      const bitrateKbps =
        deltaBytes !== undefined
          ? Math.round((deltaBytes * 8) / deltaMs)
          : Math.round(getBitrate() / 1000)

      const deltaLost = delta('packetsLost') ?? raw.packetsLost ?? 0
      const deltaReceived = delta('packetsReceived') ?? raw.packetsReceived ?? 0
      const lossPercent =
        deltaLost + deltaReceived > 0 ? (deltaLost / (deltaLost + deltaReceived)) * 100 : 0

      // jitterBufferDelay é a SOMA (em segundos) do tempo que cada quadro
      // passou no buffer; dividir pelos quadros que saíram dá a média.
      const deltaDelay = delta('jitterBufferDelay') ?? raw.jitterBufferDelay
      const deltaEmitted = delta('jitterBufferEmittedCount') ?? raw.jitterBufferEmittedCount
      const bufferMs =
        deltaDelay !== undefined && deltaEmitted
          ? Math.round((deltaDelay / deltaEmitted) * 1000)
          : 0

      setStats({
        codec: raw.mimeType ? raw.mimeType.replace(/^video\//, '').toUpperCase() : fallbackCodec,
        resolution:
          raw.frameWidth && raw.frameHeight ? `${raw.frameWidth}x${raw.frameHeight}` : '—',
        fps,
        bitrateKbps,
        lossPercent: Math.round(lossPercent * 10) / 10,
        packetsLost: raw.packetsLost ?? 0,
        jitterMs: Math.round((raw.jitter ?? 0) * 1000),
        bufferMs,
        framesDropped: raw.framesDropped ?? 0,
        freezes: raw.freezeCount ?? 0,
        freezeSeconds: Math.round((raw.totalFreezesDuration ?? 0) * 10) / 10,
        nackCount: raw.nackCount ?? 0,
        pliCount: raw.pliCount ?? 0
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
