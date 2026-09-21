import { useEffect, useState } from 'react'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

// Roadmap item 42: "há quanto tempo essa live está no ar", formatado
// HH:MM:SS. Puramente derivado do relógio local (Date.now() - startedAt),
// sem nenhum tick vindo do servidor — só um `setInterval` de 1s pra
// re-renderizar o texto. `startedAt` vem do próprio LiveKit
// (`creationTimeMs`, ver server.js), nunca do relógio de uma máquina
// cliente específica (nem host nem viewer).
export function useElapsedTime(startedAt: number | null | undefined): string {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  if (!startedAt) return '00:00:00'
  return formatElapsed(now - startedAt)
}
