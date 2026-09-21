import { useEffect, useState } from 'react'
import { Check, LayoutGrid, RefreshCw, X } from 'lucide-react'
import {
  Fps,
  FPS_OPTIONS,
  Resolution,
  RESOLUTIONS,
  TransmissionSettings
} from '../lib/transmissionSettings'

interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnailDataUrl: string
}

interface UpdateTransmissionModalProps {
  currentSettings: TransmissionSettings
  onClose: () => void
  onUpdate: (settings: TransmissionSettings) => Promise<boolean>
  error: string | null
}

// Item 13 do roadmap: troca resolução/FPS/fonte de uma live já no ar,
// sem derrubar a sala. Mesmo padrão visual da TransmissionScreen
// (pílulas, grade de thumbnails) — só reorganizado em header/body/footer
// dentro de um modal, em vez de tela cheia.
//
// NÃO conectado em lugar nenhum desde a remoção do caminho de captura
// via Chromium (2026-08-30, ver MEMORIA.md) — mantido de propósito,
// pronto pra ser religado quando o item 13 for reimplementado pro
// GStreamer (precisa de um jeito de trocar resolução/FPS/fonte da
// captura já em andamento sem derrubar o processo `gst-launch-1.0.exe`).
function UpdateTransmissionModal({
  currentSettings,
  onClose,
  onUpdate,
  error
}: UpdateTransmissionModalProps): React.JSX.Element {
  const [resolution, setResolution] = useState<Resolution>(currentSettings.resolution)
  const [fps, setFps] = useState<Fps>(currentSettings.fps)

  const [sourceType, setSourceType] = useState<'screen' | 'window'>('screen')
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourceId, setSourceId] = useState<string | null>(currentSettings.sourceId)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadSources(): Promise<void> {
      setLoadingSources(true)
      const list = await window.api.screenCapture.listSources()
      if (cancelled) return

      setSources(list)
      setLoadingSources(false)

      // Se a fonte atual da live estiver na lista, já abre na aba dela
      // (screen ou window) com ela selecionada.
      const current = list.find((source) => source.id === currentSettings.sourceId)
      if (current) {
        setSourceType(current.type)
      } else {
        setSourceId(list.find((source) => source.type === 'screen')?.id ?? null)
      }
    }

    loadSources()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredSources = sources.filter((source) => source.type === sourceType)

  function handleSelectType(type: 'screen' | 'window'): void {
    setSourceType(type)
    const firstOfType = sources.find((source) => source.type === type)
    setSourceId(firstOfType?.id ?? null)
  }

  async function handleUpdate(): Promise<void> {
    setUpdating(true)
    // A senha da sala (se tiver uma) é definida só na CRIAÇÃO (ver
    // TransmissionScreen.tsx) — atualizar resolução/FPS/fonte nunca
    // recria a sala/ingress, então só carrega a mesma senha adiante.
    const updated = await onUpdate({
      resolution,
      fps,
      sourceId,
      // Privacidade não muda com a live no ar: trocar resolução/FPS/
      // fonte não recria a sala, então o valor só é repassado.
      private: currentSettings.private
    })
    setUpdating(false)
    if (updated) onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <header className="update-modal-header">
          <div className="pill-group">
            <button
              type="button"
              className={sourceType === 'screen' ? 'pill-option pill-option-active' : 'pill-option'}
              onClick={() => handleSelectType('screen')}
            >
              Tela Inteira
            </button>
            <button
              type="button"
              className={sourceType === 'window' ? 'pill-option pill-option-active' : 'pill-option'}
              onClick={() => handleSelectType('window')}
            >
              Aplicativos
            </button>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Fechar"
            disabled={updating}
          >
            <X size={18} />
          </button>
        </header>

        <div className="update-modal-body">
          {loadingSources ? (
            <p className="source-hint">Carregando fontes...</p>
          ) : (
            <div className="source-grid">
              {filteredSources.map((source) => (
                <button
                  type="button"
                  key={source.id}
                  className={
                    source.id === sourceId ? 'source-item source-item-active' : 'source-item'
                  }
                  onClick={() => setSourceId(source.id)}
                  title={source.name}
                >
                  {source.thumbnailDataUrl ? (
                    <img src={source.thumbnailDataUrl} alt="" className="source-thumbnail" />
                  ) : (
                    <div className="source-thumbnail-placeholder">
                      <LayoutGrid size={28} />
                    </div>
                  )}
                  {source.id === sourceId && (
                    <span className="source-check-badge">
                      <Check size={14} />
                    </span>
                  )}
                  <span className="source-name">{source.name}</span>
                </button>
              ))}
              {filteredSources.length === 0 && (
                <p className="source-hint">Nenhuma fonte encontrada.</p>
              )}
            </div>
          )}
          {error && <p className="auth-error">{error}</p>}
        </div>

        <footer className="update-modal-footer">
          <div className="update-modal-footer-left">
            <div className="settings-group">
              <span className="settings-group-label">Resolução</span>
              <div className="pill-group">
                {RESOLUTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={
                      option === resolution ? 'pill-option pill-option-active' : 'pill-option'
                    }
                    onClick={() => setResolution(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-group">
              <span className="settings-group-label">FPS</span>
              <div className="pill-group">
                {FPS_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    className={option === fps ? 'pill-option pill-option-active' : 'pill-option'}
                    onClick={() => setFps(option)}
                  >
                    {option} FPS
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="transmission-start"
            onClick={handleUpdate}
            disabled={updating || !sourceId}
          >
            <RefreshCw size={16} />
            {updating ? 'Atualizando...' : 'Atualizar transmissão'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default UpdateTransmissionModal
