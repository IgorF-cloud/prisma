import { useState } from 'react'
import { Activity } from 'lucide-react'
import { RawTrackStats, useTrackStats } from '../lib/useTrackStats'
import StatsPanel from './StatsPanel'

interface HostPreviewTileProps {
  attachVideo: (element: HTMLVideoElement | null) => void
  fetchStats: () => Promise<RawTrackStats | undefined>
  getBitrate: () => number
  // Item 32 do roadmap ("Modo foco") — mesmo mecanismo do ViewerTile.tsx.
  focused: boolean
  onToggleFocus: () => void
}

// Item 15 do roadmap: preview da própria live pro HOST (via
// useHostPreview.ts — o vídeo é literalmente recebido de volta via
// WebRTC, não é o stream local, ver comentário lá pro porquê). Pedido
// explícito do usuário: SÓ o botão de estatísticas, nada de volume,
// mute, fullscreen ou lista de espectadores (isso é preview da MINHA
// live, não uma live de terceiro) — por isso é um componente separado
// do ViewerTile.tsx, bem mais enxuto, em vez de encher o ViewerTile de
// props condicionais.
function HostPreviewTile({
  attachVideo,
  fetchStats,
  getBitrate,
  focused,
  onToggleFocus
}: HostPreviewTileProps): React.JSX.Element {
  const [statsOpen, setStatsOpen] = useState(false)
  // Mesmo "Aguardando transmissão" do ViewerTile.tsx — o preview também
  // fica preto até o primeiro frame chegar de volta (viewer oculto).
  const [hasVideo, setHasVideo] = useState(false)
  const stats = useTrackStats(statsOpen, 'H264', fetchStats, getBitrate)

  // Item 32 do roadmap: mesma ideia do ViewerTile.tsx, mas aqui o único
  // controle flutuante é o botão de estatísticas — marcado `tile-control`
  // pra ficar de fora do toggle, igual lá.
  function handleFrameClick(event: React.MouseEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('.tile-control')) return
    onToggleFocus()
  }

  return (
    <div className={`watch-tile watch-tile-self${focused ? ' watch-tile-focused' : ''}`}>
      <div
        className={`watch-video-frame${!hasVideo ? ' watch-video-frame-loading' : ''}`}
        onClick={handleFrameClick}
      >
        {/* muted: o áudio dessa track é o mesmo som do host com o atraso
            da volta completa (captura→encode→WHIP→SFU→decode) — sem
            mutar, seria um eco bem perceptível por cima do áudio real. */}
        <video
          ref={attachVideo}
          className="watch-video"
          autoPlay
          muted
          playsInline
          onLoadedData={() => setHasVideo(true)}
        />

        {!hasVideo && (
          <div className="watch-loading">
            <span className="watch-loading-spinner" />
            <p className="watch-loading-text">Aguardando transmissão</p>
          </div>
        )}

        {hasVideo && (
          <>
            <span className="watch-tile-label">Sua transmissão</span>

            {/* Mesmo padrão do ViewerTile.tsx — abre e fecha no clique
                desde 2026-10-16. `stats-toggle-solo` porque aqui é o
                ÚNICO botão do chip (precisa de raio nos 4 cantos, não só
                nos 2 de uma ponta como no ViewerTile). */}
            <div className="tile-top-right-actions">
              <div className="stats-toggle-wrapper">
                <button
                  type="button"
                  className={`stats-toggle stats-toggle-solo tile-control${statsOpen ? ' stats-toggle-active' : ''}`}
                  onClick={() => setStatsOpen((open) => !open)}
                  aria-label={statsOpen ? 'Fechar estatísticas' : 'Ver estatísticas'}
                  aria-expanded={statsOpen}
                >
                  <Activity size={14} />
                </button>
                <div
                  className={`stats-panel-anchor tile-control${statsOpen ? ' stats-panel-anchor-open' : ''}`}
                >
                  <StatsPanel stats={stats} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default HostPreviewTile
