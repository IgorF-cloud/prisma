import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Users,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { RawTrackStats, useTrackStats } from '../lib/useTrackStats'
import { useAutoHideOverlay } from '../lib/useAutoHideOverlay'
import StatsPanel from './StatsPanel'

interface ViewerTileProps {
  hostName: string
  // Item 28 do roadmap: quantidade de quem mais está assistindo ESSA
  // live (não é a própria sala do host — isso é o item 17, no footer da
  // Home). Pedido do usuário (2026-09-03): virou só a CONTAGEM, sem
  // hover nem lista de nomes — a lista de espectadores por sala foi
  // parar do lado de fora, embaixo do tile na sidebar (ver
  // HomeScreen.tsx), não faz mais sentido duplicar aqui.
  participants: string[]
  volume: number
  muted: boolean
  onSetVolume: (volume: number) => void
  onSetMuted: (muted: boolean) => void
  onLeave: () => void
  attachVideo: (element: HTMLVideoElement | null) => void
  attachAudioContainer: (element: HTMLDivElement | null) => void
  fetchStats: () => Promise<RawTrackStats | undefined>
  getBitrate: () => number
  // Item 32 do roadmap ("Modo foco"): um clique em qualquer parte do
  // vídeo (fora dos controles flutuantes) expande essa live pra ocupar
  // toda a janela — ver onToggleFocus/handleFrameClick abaixo e
  // HomeScreen.tsx pro porquê disso ser controlado de fora (só uma live
  // focada por vez, entre N tiles).
  focused: boolean
  onToggleFocus: () => void
  // Mini player (2026-09-20, pedido do usuário): manda ESTA live pra uma
  // janelinha sempre-no-topo. Quem controla é a HomeScreen — só uma live
  // por vez pode estar lá, e o tile da que está some da grade.
  onPopin: () => void
}

// Extraído da HomeScreen porque item 26 (estatísticas) precisa de um
// `useTrackStats` (hook) por tile — como a quantidade de tiles varia
// (item 23, N lives assistidas), chamar hooks dentro de um .map() direto
// quebraria as regras do React. Um componente próprio por tile resolve
// isso: cada instância chama o hook uma vez só, do jeito de sempre.
function ViewerTile({
  hostName,
  participants,
  volume,
  muted,
  onSetVolume,
  onSetMuted,
  onLeave,
  attachVideo,
  attachAudioContainer,
  fetchStats,
  getBitrate,
  focused,
  onToggleFocus,
  onPopin
}: ViewerTileProps): React.JSX.Element {
  const [statsOpen, setStatsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // Item novo: "Aguardando transmissão" enquanto o <video> ainda não tem
  // o primeiro frame de verdade (a track já chega e o elemento já monta
  // bem antes disso — sem isso, ficava um quadrado preto parado).
  const [hasVideo, setHasVideo] = useState(false)
  const stats = useTrackStats(statsOpen, 'H264', fetchStats, getBitrate)
  const displayedVolume = muted ? 0 : volume
  const frameRef = useRef<HTMLDivElement | null>(null)
  const overlay = useAutoHideOverlay()

  // Item 25 do roadmap: fullscreen NATIVO (Fullscreen API, não um
  // overlay via CSS) — sincroniza o estado do botão com o real, porque
  // dá pra sair do fullscreen sem clicar nele de novo (tecla Esc, gesto
  // do SO), e sem isso o ícone ficaria mostrando "entrar" quando na
  // verdade já saiu.
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

  // Item 32 do roadmap: qualquer canto do vídeo é clicável pra
  // entrar/sair do modo foco, EXCETO os controles flutuantes — todos já
  // levam a classe `tile-control` (reaproveitada do auto-hide acima), daí
  // o mesmo `.closest()` resolver os dois casos.
  function handleFrameClick(event: React.MouseEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('.tile-control')) return
    onToggleFocus()
  }

  return (
    <div className={`watch-tile${focused ? ' watch-tile-focused' : ''}`}>
      <div
        className={`watch-video-frame${!hasVideo ? ' watch-video-frame-loading' : ''}`}
        ref={frameRef}
        onClick={handleFrameClick}
      >
        <video
          ref={attachVideo}
          className="watch-video"
          autoPlay
          playsInline
          onLoadedData={() => setHasVideo(true)}
        />

        {!hasVideo && (
          <div className="watch-loading">
            <span className="watch-loading-spinner" />
            <p className="watch-loading-text">Aguardando transmissão</p>
            {/* Item 34 do roadmap: os controles flutuantes normais só
                aparecem depois do primeiro frame (`hasVideo`) — sem isso,
                se travar aqui (o host nunca chegou a publicar de
                verdade, por exemplo), o viewer ficava sem jeito nenhum
                de sair da sala. Mesmo onLeave do leave-toggle normal, só
                que sempre visível nesse estado (não depende do
                auto-hide). Só na live ASSISTIDA — a própria transmissão
                do host (HostPreviewTile.tsx) já tem o botão do olho no
                footer pra isso. */}
            <button
              type="button"
              className="leave-toggle-loading tile-control"
              onClick={onLeave}
              aria-label="Sair da live"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {hasVideo && (
          <div
            // Com as estatísticas abertas a barra não some sozinha: o
            // painel fica pendurado nela, e sumir junto seria fechar o
            // painel sem a pessoa ter pedido.
            className={`tile-overlay${overlay.visible || statsOpen ? ' tile-overlay-visible' : ''}`}
            onMouseMove={overlay.onMouseMove}
            onMouseLeave={overlay.onMouseLeave}
          >
            <span className="watch-tile-label tile-control">
              <span className="watch-tile-label-dot" />
              Live de {hostName}
            </span>

            <div className="tile-top-right-actions">
              {/* Pedido do usuário (2026-09-03): removido o hover/lista de
                  espectadores daqui (era o mesmo padrão do "quem está
                  assistindo MINHA live" do footer) — vira só a contagem,
                  sem interação nenhuma (a lista de nomes por sala já
                  aparece embaixo do tile na sidebar, ver HomeScreen.tsx). */}
              <span className="viewers-toggle tile-control">
                <Users size={13} />
                {participants.length}
              </span>
              {/* Pedido do usuário (2026-10-16): abre e fecha no CLIQUE,
                  não mais no hover — dá pra deixar aberto olhando os
                  números enquanto a live roda. */}
              <div className="stats-toggle-wrapper">
                <button
                  type="button"
                  className={`stats-toggle tile-control${statsOpen ? ' stats-toggle-active' : ''}`}
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
              <button
                type="button"
                className="leave-toggle tile-control"
                onClick={onLeave}
                aria-label="Sair da live"
              >
                <X size={14} />
              </button>
            </div>

            <div className="volume-chip tile-control">
              <button
                type="button"
                className="volume-mute-button"
                onClick={() => onSetMuted(!muted)}
                aria-label={muted ? 'Ativar som' : 'Mutar'}
              >
                {displayedVolume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
              </button>
              <input
                type="range"
                className="volume-slider"
                min={0}
                max={100}
                value={Math.round(displayedVolume * 100)}
                onChange={(e) => onSetVolume(Number(e.target.value) / 100)}
                style={{
                  background: `linear-gradient(to right, #a78bfa ${displayedVolume * 100}%, var(--ev-c-gray-2) ${displayedVolume * 100}%)`
                }}
                aria-label="Volume"
              />
            </div>

            {/* Mini player (2026-09-20, pedido do usuário) — ao lado do
                botão de tela cheia, que é o controle de "onde esta live
                aparece" mais parecido com ele.

                Sem rótulo e sem tooltip (pedido do usuário, 2026-09-21):
                os dois já tiveram um texto que abria no hover e depois um
                balão, e os dois saíram. Ficam só os ícones e o hover que
                clareia o fundo. O `aria-label` continua, que é o que
                responde por eles em leitor de tela. */}
            <div className="tile-corner-controls tile-control">
              <button
                type="button"
                className="popin-toggle tile-control"
                onClick={onPopin}
                aria-label="Abrir em mini player"
              >
                <PictureInPicture2 size={14} />
              </button>

              <button
                type="button"
                className="fullscreen-toggle tile-control"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>
      <div ref={attachAudioContainer} hidden />
    </div>
  )
}

export default ViewerTile
