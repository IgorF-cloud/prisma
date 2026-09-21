import { useEffect, useRef, useState } from 'react'

const HIDE_DELAY_MS = 3000

// Controles flutuantes de uma live (tag do host, espectadores,
// estatísticas, sair, volume) só aparecem enquanto o mouse se move sobre
// ela, e somem 3s depois de parar — igual player de vídeo. Parado EM CIMA
// de um controle (`.tile-control`) não conta como "parado": fica visível
// até o cursor sair dele.
//
// Morava dentro do ViewerTile.tsx até 2026-09-20, quando o mini player
// (PopinPlayer.tsx) passou a precisar do MESMO comportamento — era pedido
// explícito do usuário que as regras de hover dos chips valessem também
// na janelinha. Duas cópias da mesma regra é como as duas telas começam a
// se comportar diferente.
export function useAutoHideOverlay(): {
  visible: boolean
  onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
} {
  const [visible, setVisible] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearHideTimeout(): void {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }

  function scheduleHide(): void {
    clearHideTimeout()
    hideTimeoutRef.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS)
  }

  function onMouseMove(event: React.MouseEvent<HTMLDivElement>): void {
    setVisible(true)
    const overControl = (event.target as HTMLElement).closest('.tile-control') !== null
    if (overControl) {
      clearHideTimeout()
    } else {
      scheduleHide()
    }
  }

  function onMouseLeave(): void {
    clearHideTimeout()
    setVisible(false)
  }

  useEffect(() => clearHideTimeout, [])

  return { visible, onMouseMove, onMouseLeave }
}
