import { DisplayStats } from '../lib/useTrackStats'

interface StatsPanelProps {
  stats: DisplayStats | null
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

// Item 26 do roadmap: painel de estatísticas em tempo real — mesmo
// componente pro host (própria live) e pro viewer (live assistida), só
// muda de onde os dados vêm (ver useTrackStats.ts).
//
// As linhas de baixo (2026-10-16) são as de diagnóstico de travamento:
// perda e NACK subindo apontam pra rede; quadros descartados subindo com
// perda zerada apontam pro PC de quem assiste (não deu conta de
// decodificar). O `title` de cada rótulo explica isso no hover.
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
            <span className="stats-label" title="Pacotes perdidos nos últimos 2s · total">
              Perda
            </span>
            <span className="stats-value">
              {decimal.format(stats.lossPercent)}% · {stats.packetsLost} pkt
            </span>
          </div>
          <div className="stats-row">
            <span
              className="stats-label"
              title="Variação no tempo de chegada dos pacotes · quanto o player segura antes de mostrar"
            >
              Jitter/Buffer
            </span>
            <span className="stats-value">
              {stats.jitterMs} ms · {stats.bufferMs} ms
            </span>
          </div>
          <div className="stats-row">
            <span className="stats-label" title="Quantas vezes o vídeo congelou · tempo total">
              Travadas
            </span>
            <span className="stats-value">
              {stats.freezes} · {decimal.format(stats.freezeSeconds)} s
            </span>
          </div>
          <div className="stats-row">
            <span
              className="stats-label"
              title="Quadros que chegaram mas não foram mostrados (PC sem fôlego pra decodificar)"
            >
              Quadros descartados
            </span>
            <span className="stats-value">{stats.framesDropped}</span>
          </div>
          <div className="stats-row">
            <span
              className="stats-label"
              title="Pedidos de reenvio de pacote · pedidos de quadro-chave (sobem quando a rede perde dados)"
            >
              NACK/PLI
            </span>
            <span className="stats-value">
              {stats.nackCount} · {stats.pliCount}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export default StatsPanel
