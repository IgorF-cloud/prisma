import { useState } from 'react'
import { Square, Video } from 'lucide-react'
import { WebcamStatus } from '../lib/useWebcamTransmission'
import LiveTimer from './LiveTimer'
import MarqueeText from './MarqueeText'
import Tooltip from './Tooltip'

interface WebcamLiveCardProps {
  status: WebcamStatus
  deviceName: string | null
  startedAt: number | null
  attachVideo: (element: HTMLVideoElement | null) => void
  onStop: () => void
}

// O TILE DO VÍDEO no rodapé da minha live (etapa 4; redesenhado em
// 2026-10-21/22 junto com o da tela): numa linha só — a MINIATURA ao vivo
// da câmera no lugar do ícone, "VÍDEO · tempo no ar" pequeno em cima, o
// nome da câmera em destaque embaixo, e o parar (botão de ícone) no fim.
//
// A miniatura vem do plano B da etapa 0 — o participante oculto
// `<host>-cam-preview` (ver useHostPreview), porque a câmera não abre em
// dois programas ao mesmo tempo. Espelhada, como a prévia da janela.
function WebcamLiveCard({
  status,
  deviceName,
  startedAt,
  attachVideo,
  onStop
}: WebcamLiveCardProps): React.JSX.Element {
  const [hasVideo, setHasVideo] = useState(false)

  if (status === 'stopping') {
    return (
      <div className="ml-tile ml-tile-cam ml-tile-stopping">
        <span className="live-status-stopping-spinner" />
        <span className="live-tile-stopping-label">Parando vídeo...</span>
      </div>
    )
  }

  return (
    <div className="ml-tile ml-tile-cam">
      <div className={`ml-tile-thumb${hasVideo ? '' : ' ml-tile-thumb-waiting'}`}>
        {/* muted: a webcam não tem áudio, mas o autoplay do Chromium só é
            garantido com o vídeo mudo. */}
        <video
          ref={attachVideo}
          autoPlay
          muted
          playsInline
          onLoadedData={() => setHasVideo(true)}
        />
        {!hasVideo && <Video size={16} />}
      </div>
      <div className="ml-tile-text">
        <span className="ml-tile-kind">
          Vídeo
          <span
            className={`ml-tile-dot${status === 'live' ? '' : ' ml-tile-dot-connecting'}`}
            aria-hidden="true"
          />
          <LiveTimer startedAt={startedAt} className="ml-tile-timer" />
        </span>
        <div className="ml-tile-subtitle-box">
          <MarqueeText text={deviceName ?? 'Webcam'} className="ml-tile-subtitle" />
        </div>
      </div>

      <div className="ml-tile-actions">
        <Tooltip label="Parar Transmissão" placement="top-end">
          <button
            type="button"
            className="ml-tile-icon-button ml-tile-stop"
            onClick={onStop}
            aria-label="Parar a transmissão do vídeo"
          >
            <Square size={12} fill="currentColor" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export default WebcamLiveCard
