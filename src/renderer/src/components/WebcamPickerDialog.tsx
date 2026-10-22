import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Lock, RefreshCw, Video, VideoOff, X } from 'lucide-react'
import { WebcamDevice } from '../lib/useWebcamTransmission'

// A JANELA DE ESCOLHER A WEBCAM (2026-10-20, item 26 do roadmap)
//
// Pedido do usuário: um botão só pra webcam, separado do de transmitir a
// tela, que abre esta janela — a lista de câmeras e o preview da
// escolhida, SEM resolução nem FPS (o app pega sozinho o melhor que a
// câmera dá, ver webcamCapture.ts).
//
// O preview é do próprio Chromium (`getUserMedia`), sem rede nenhuma. Ele
// só funciona porque roda ANTES da transmissão: no Windows a câmera é de
// quem abriu primeiro (testado na etapa 0 do item), e por isso o preview
// é fechado antes de `onPick` — o GStreamer precisa dela livre.

interface WebcamPickerDialogProps {
  // A sala do host já existe (a tela está no ar): a webcam entra nela, e
  // a privacidade é a da sala — mostrada travada.
  lockedPrivate: boolean | null
  onClose: () => void
  onPick: (device: WebcamDevice, isPrivate: boolean) => void
  // O seletor ÚNICO (2026-10-22) — ver TransmitKindSwitch.
  kindSwitch?: React.ReactNode
  instant?: boolean
  // A sala privada é UMA escolha pras duas abas do seletor (2026-10-22) —
  // o valor de partida e o aviso a cada troca; quem guarda é o App.
  initialPrivate?: boolean
  onPrivateChange?: (isPrivate: boolean) => void
}

// O Chromium põe " (vid:pid)" no fim do nome de câmera USB no Windows —
// "HD Webcam (046d:0825)". O GStreamer conhece a câmera pelo nome sem
// isso.
function cleanCameraName(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
}

// A última câmera usada, pra janela abrir nela. Conveniência só desta
// máquina — sem ela, abre na primeira da lista.
const LAST_CAMERA_KEY = 'prisma.lastWebcam'

function loadLastCamera(): string | null {
  try {
    return localStorage.getItem(LAST_CAMERA_KEY)
  } catch {
    return null
  }
}

function saveLastCamera(name: string): void {
  try {
    localStorage.setItem(LAST_CAMERA_KEY, name)
  } catch {
    // Sem armazenamento a janela só abre na primeira câmera da próxima vez.
  }
}

// O erro do `getUserMedia`, no que a pessoa pode fazer a respeito.
function previewErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'O Windows bloqueou o acesso à câmera. Libere em Configurações > Privacidade > Câmera.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'A câmera está sendo usada por outro programa (Discord, Teams, OBS). Feche-o e tente de novo.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Esta câmera não foi encontrada. Ela pode ter sido desconectada.'
  }
  return 'Não foi possível abrir a câmera.'
}

function WebcamPickerDialog({
  lockedPrivate,
  onClose,
  onPick,
  kindSwitch = null,
  instant = false,
  initialPrivate = false,
  onPrivateChange
}: WebcamPickerDialogProps): React.JSX.Element {
  const [devices, setDevices] = useState<WebcamDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewReady, setPreviewReady] = useState(false)
  const [isPrivate, setIsPrivate] = useState(lockedPrivate ?? initialPrivate)
  // "Tentar de novo" com a MESMA câmera escolhida: sem isto o efeito do
  // preview não rodaria de novo (o `selectedId` não mudou).
  const [attempt, setAttempt] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  function stopPreview(): void {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  // A lista de câmeras. Os NOMES só vêm depois de a página ter pedido
  // acesso à câmera uma vez — sem isso o `enumerateDevices` devolve as
  // câmeras com rótulo vazio. Por isso o primeiro passo abre (e fecha) a
  // câmera padrão.
  //
  // Roda de novo a cada "Tentar de novo" (`attempt`) e quando uma câmera é
  // plugada ou desplugada com a janela aberta. O estado só muda depois
  // dos `await` — o `loading` já nasce verdadeiro.
  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        let cams = all.filter((d) => d.kind === 'videoinput')
        if (cams.length > 0 && cams.every((d) => !d.label)) {
          const probe = await navigator.mediaDevices.getUserMedia({ video: true })
          probe.getTracks().forEach((track) => track.stop())
          cams = (await navigator.mediaDevices.enumerateDevices()).filter(
            (d) => d.kind === 'videoinput'
          )
        }
        if (cancelled) return
        const list = cams.map((d, index) => ({
          id: d.deviceId,
          name: cleanCameraName(d.label) || `Câmera ${index + 1}`
        }))
        setDevices(list)
        setSelectedId((current) => {
          if (current && list.some((d) => d.id === current)) return current
          const last = loadLastCamera()
          return (list.find((d) => d.name === last) ?? list[0])?.id ?? null
        })
      } catch (err) {
        if (!cancelled) setPreviewError(previewErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const onChange = (): void => void load()
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
    }
  }, [attempt])

  // Trocar de câmera (ou tentar de novo) volta o preview ao "abrindo".
  // Aqui, no gesto, e não no efeito abaixo — a regra do projeto não deixa
  // um efeito mexer em estado só pra se preparar.
  function selectCamera(id: string): void {
    if (id === selectedId) return
    setPreviewReady(false)
    setPreviewError(null)
    setSelectedId(id)
  }

  function retry(): void {
    setPreviewReady(false)
    setPreviewError(null)
    setAttempt((n) => n + 1)
  }

  // O preview da câmera escolhida. Troca de câmera = fecha a anterior
  // ANTES de abrir a outra (algumas não abrem duas ao mesmo tempo).
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    stopPreview()
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: selectedId } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(previewErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, attempt])

  // A janela fechando por qualquer caminho solta a câmera.
  useEffect(() => stopPreview, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const selected = devices.find((d) => d.id === selectedId) ?? null

  function handleStart(): void {
    if (!selected) return
    // A câmera tem que estar LIVRE quando o GStreamer for abri-la.
    stopPreview()
    saveLastCamera(selected.name)
    onPick(selected, lockedPrivate ?? isPrivate)
  }

  return createPortal(
    <div
      className={`modal-backdrop source-picker-backdrop${instant ? ' modal-instant' : ''}`}
      onClick={onClose}
    >
      <div
        className="webcam-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={kindSwitch ? undefined : 'webcam-picker-title'}
        aria-label={kindSwitch ? 'Escolher o que transmitir' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* O CABEÇALHO (2026-10-22): a chave "Tela | Vídeo" quando o seletor
            é o único da barra; sozinho, o título de sempre. */}
        <header className="webcam-picker-header picker-header">
          {kindSwitch ?? (
            <>
              <div className="settings-modal-heading">
                <span className="settings-modal-icon">
                  <Video size={18} />
                </span>
                <div className="settings-modal-titles">
                  <h2 id="webcam-picker-title" className="settings-modal-title">
                    Transmitir vídeo
                  </h2>
                  <p className="settings-modal-subtitle">
                    {lockedPrivate !== null
                      ? 'O vídeo entra na sua live, ao lado da tela'
                      : 'Escolha a câmera que você quer transmitir'}
                  </p>
                </div>
              </div>
            </>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="webcam-picker-body">
          <div className="webcam-picker-preview">
            <video
              ref={videoRef}
              className={`webcam-picker-video${previewReady ? ' webcam-picker-video-ready' : ''}`}
              autoPlay
              playsInline
              muted
              onLoadedData={() => setPreviewReady(true)}
            />
            {previewError ? (
              <div className="webcam-picker-preview-state webcam-picker-preview-error">
                <VideoOff size={26} />
                <p>{previewError}</p>
                <button type="button" className="webcam-picker-retry" onClick={retry}>
                  <RefreshCw size={13} />
                  Tentar de novo
                </button>
              </div>
            ) : (
              !previewReady && (
                <div className="webcam-picker-preview-state">
                  <span className="watch-loading-spinner" />
                  <p>{loading ? 'Procurando câmeras' : 'Abrindo a câmera'}</p>
                </div>
              )
            )}
            {previewReady && !previewError && (
              <span className="webcam-picker-preview-badge">
                <span className="webcam-picker-preview-dot" />
                Prévia
              </span>
            )}
          </div>

          <div className="webcam-picker-devices">
            <span className="room-details-label">Câmeras</span>
            {!loading && devices.length === 0 ? (
              <div className="webcam-picker-empty">
                <VideoOff size={18} />
                <span>Nenhuma câmera encontrada</span>
              </div>
            ) : (
              <ul className="webcam-picker-list">
                {devices.map((device) => {
                  const active = device.id === selectedId
                  return (
                    <li key={device.id}>
                      <button
                        type="button"
                        className={`webcam-picker-device${active ? ' webcam-picker-device-active' : ''}`}
                        onClick={() => selectCamera(device.id)}
                        aria-pressed={active}
                      >
                        <span className="webcam-picker-device-icon">
                          <Video size={15} />
                        </span>
                        <span className="webcam-picker-device-name">{device.name}</span>
                        {active && <Check size={15} className="webcam-picker-device-check" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="webcam-picker-hint">
              Só vídeo, sem áudio. A qualidade é ajustada sozinha ao melhor que a câmera oferece.
            </p>
          </div>
        </div>

        <footer className="webcam-picker-footer">
          <label
            className={
              lockedPrivate !== null ? 'private-switch private-switch-locked' : 'private-switch'
            }
          >
            <span className="private-switch-text">
              <span className="private-switch-title">
                <Lock size={13} />
                Sala privada
              </span>
              <span className="private-switch-description">
                {lockedPrivate !== null
                  ? 'Definida ao iniciar a live'
                  : isPrivate
                    ? 'Só entra quem você convidar'
                    : 'Aparece pra todo mundo'}
              </span>
            </span>
            <input
              type="checkbox"
              className="private-switch-input"
              checked={lockedPrivate ?? isPrivate}
              disabled={lockedPrivate !== null}
              onChange={(e) => {
                setIsPrivate(e.target.checked)
                onPrivateChange?.(e.target.checked)
              }}
            />
            <span className="private-switch-track">
              <span className="private-switch-thumb" />
            </span>
          </label>

          <button
            type="button"
            className="webcam-picker-start"
            onClick={handleStart}
            disabled={!selected || Boolean(previewError)}
          >
            <Video size={15} />
            Transmitir vídeo
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

export default WebcamPickerDialog
