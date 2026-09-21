import { useElapsedTime } from '../lib/useElapsedTime'

interface LiveTimerProps {
  startedAt: number | null | undefined
  className?: string
}

// Roadmap item 42: componente isolado (não o hook direto no map da lista
// de salas) de propósito — cada tile precisa do próprio tick de 1s
// independente dos outros, sem re-renderizar a lista inteira a cada
// segundo (regra dos hooks também não deixaria chamar useElapsedTime
// dentro de um .map() no componente pai).
function LiveTimer({ startedAt, className }: LiveTimerProps): React.JSX.Element {
  const elapsed = useElapsedTime(startedAt)
  return <span className={className}>{elapsed}</span>
}

export default LiveTimer
