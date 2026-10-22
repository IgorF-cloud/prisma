import { useState } from 'react'
import { Activity, Expand, Shrink } from 'lucide-react'
import { RawTrackStats, useTrackStats } from '../lib/useTrackStats'
import StatsPanel from './StatsPanel'

interface HostPreviewTileProps {
  attachVideo: (element: HTMLVideoElement | null) => void
  fetchStats: () => Promise<RawTrackStats | undefined>
  getBitrate: () => number
  // Item 32 do roadmap ("Modo foco") — mesmo mecanismo do ViewerTile.tsx.
  focused: boolean
  onToggleFocus: () => void
  // Destaque (2026-10-22) — mesmo mecanismo do ViewerTile.tsx.
  featured?: boolean
  onSelect?: () => void
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
  onToggleFocus,
  featured = false,
  onSelect
}: HostPreviewTileProps): React.JSX.Element {
  const [statsOpen, setStatsOpen] = useState(false)
  // Mesmo "Aguardando transmissão" do ViewerTile.tsx — o preview também
  // fica preto até o primeiro frame chegar de volta (viewer oculto).
  const [hasVideo, setHasVideo] = useState(false)
  const stats = useTrackStats(statsOpen, 'H264', fetchStats, getBitrate)

  // Mesma ideia do ViewerTile.tsx: o clique no vídeo é o destaque, e os
  // botões (marcados `tile-control`) ficam de fora dele.
  function handleFrameClick(event: React.MouseEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('.tile-control')) return
    onSelect?.()
  }

  return (
    <div
      className={`watch-tile watch-tile-self${focused ? ' watch-tile-focused' : ''}${featured ? ' watch-tile-featured' : ''}`}
    >
      <div
        className={`watch-video-frame${!hasVideo ? ' watch-video-frame-loading' : ''}${onSelect ? ' watch-video-frame-selectable' : ''}`}
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
            <span className="tile-chip tile-chip-label tile-chip-tl">
              <span className="tile-chip-live-dot" />
              Sua transmissão
            </span>

            {/* Mesmo padrão do ViewerTile.tsx — abre e fecha no clique
                desde 2026-10-16. */}
            <div className="tile-chip tile-chip-tr">
              <div className="stats-toggle-wrapper">
                <button
                  type="button"
                  className={`tile-chip-button tile-control${statsOpen ? ' tile-chip-button-active' : ''}`}
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

            <div className="tile-chip tile-chip-br tile-control">
              <button
                type="button"
                className={`tile-chip-button tile-control${focused ? ' tile-chip-button-active' : ''}`}
                onClick={onToggleFocus}
                aria-label={focused ? 'Sair do modo foco' : 'Modo foco'}
              >
                {focused ? <Shrink size={14} /> : <Expand size={14} />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default HostPreviewTile
