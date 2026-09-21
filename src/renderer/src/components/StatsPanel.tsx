import { DisplayStats } from '../lib/useTrackStats'

interface StatsPanelProps {
  stats: DisplayStats | null
}

// Item 26 do roadmap: painel de estatísticas em tempo real — mesmo
// componente pro host (própria live) e pro viewer (live assistida), só
// muda de onde os dados vêm (ver useTrackStats.ts).
function StatsPanel({ stats }: StatsPanelProps): React.JSX.Element {
  return (
    <div className="stats-panel">
      {!stats ? (
        <p className="stats-loading">Carregando...</p>
      ) : (
        <>
          <div className="stats-row">
            <span className="stats-label">Codec</span>
            <span className="stats-value">{stats.codec}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Resolução</span>
            <span className="stats-value">{stats.resolution}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">FPS</span>
            <span className="stats-value">{stats.fps}</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Bitrate</span>
            <span className="stats-value">{stats.bitrateKbps} kbps</span>
          </div>
          <div className="stats-row">
            <span className="stats-label">Perda/Jitter</span>
            <span className="stats-value">
              {stats.packetsLost} pkt · {stats.jitterMs} ms
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export default StatsPanel
