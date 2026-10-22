import { useEffect, useRef, useState } from 'react'
import { Expand, Maximize2, Minimize2, Shrink, Video, X } from 'lucide-react'
import { useAutoHideOverlay } from '../lib/useAutoHideOverlay'

interface ViewerCamTileProps {
  hostName: string
  attachVideo: (element: HTMLVideoElement | null) => void
  // Fecha SÓ este tile (a webcam), ou sai da sala se for o último tile
  // visível dela — quem decide é a HomeScreen.
  onClose: () => void
  focused: boolean
  onToggleFocus: () => void
  // Destaque (2026-10-22) — mesmo mecanismo do ViewerTile.tsx.
  featured?: boolean
  onSelect?: () => void
}

// O tile da WEBCAM de quem transmite (2026-10-20, item 26 do roadmap).
//
// Decisão do usuário: a webcam aparece "como se fosse outra live", num
// tile próprio ao lado do da tela — mas sem áudio e sem os detalhes da
// live. Por isso é um componente separado do ViewerTile e não um modo
// dele: aqui não há volume, estatísticas nem contagem de espectadores
// (esses são da live, e já estão no tile da tela). Fica o que é do VÍDEO:
// o chip dizendo de quem é e que é a webcam, tela cheia, modo foco e
// fechar.
function ViewerCamTile({
  hostName,
  attachVideo,
  onClose,
  focused,
  onToggleFocus,
  featured = false,
  onSelect
}: ViewerCamTileProps): React.JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const overlay = useAutoHideOverlay()

  // Mesma sincronização do ViewerTile: dá pra sair da tela cheia pelo Esc.
  useEffect(() => {
    function handleFullscreenChange(): void {
      setFullscreen(document.fullscreenElement === frameRef.current)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  function toggleFullscreen(): void {
    if (document.fullscreenElement === frameRef.current) {
      document.exitFullscreen().catch(() => {})
    } else {
      frameRef.current?.requestFullscreen().catch(() => {})
    }
  }

  function handleFrameClick(event: React.MouseEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('.tile-control')) return
    onSelect?.()
  }

  return (
    <div
      className={`watch-tile watch-tile-cam${focused ? ' watch-tile-focused' : ''}${featured ? ' watch-tile-featured' : ''}`}
    >
      <div
        className={`watch-video-frame${!hasVideo ? ' watch-video-frame-loading' : ''}${onSelect ? ' watch-video-frame-selectable' : ''}`}
        ref={frameRef}
        onClick={handleFrameClick}
      >
        <video
          ref={attachVideo}
          className="watch-video"
          autoPlay
          playsInline
          muted
          onLoadedData={() => setHasVideo(true)}
        />

        {!hasVideo && (
          <div className="watch-loading">
            <span className="watch-loading-cam">
              <Video size={20} />
            </span>
            <p className="watch-loading-text">Aguardando webcam</p>
            <div className="tile-chip tile-chip-tr tile-chip-loading">
              <button
                type="button"
                className="tile-chip-button tile-chip-button-danger tile-control"
                onClick={onClose}
                aria-label="Fechar webcam"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {hasVideo && (
          <div
            className={`tile-overlay${overlay.visible ? ' tile-overlay-visible' : ''}`}
            onMouseMove={overlay.onMouseMove}
            onMouseLeave={overlay.onMouseLeave}
          >
            <span className="tile-chip tile-chip-label tile-chip-tl tile-control">
              <span className="tile-chip-live-dot" />
              {hostName}
              <span className="tile-chip-tag tile-chip-tag-accent">
                <Video size={11} />
                Webcam
              </span>
            </span>

            <div className="tile-chip tile-chip-tr">
              <button
                type="button"
                className="tile-chip-button tile-chip-button-danger tile-control"
                onClick={onClose}
                aria-label="Fechar webcam"
              >
                <X size={15} />
              </button>
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

              <button
                type="button"
                className="tile-chip-button tile-control"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ViewerCamTile
