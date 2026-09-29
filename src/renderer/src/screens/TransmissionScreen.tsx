import { useEffect, useState } from 'react'
import { ArrowLeft, Cast, Lock } from 'lucide-react'
import {
  Fps,
  FPS_OPTIONS,
  Resolution,
  RESOLUTIONS,
  TransmissionSettings
} from '../lib/transmissionSettings'
import { loadLastQuality, saveLastQuality } from '../lib/lastTransmissionQuality'
import CaptureSourceCard, { CaptureSource } from '../components/CaptureSourceCard'

interface TransmissionScreenProps {
  onBack: () => void
  onStart: (settings: TransmissionSettings) => Promise<boolean>
}

function TransmissionScreen({ onBack, onStart }: TransmissionScreenProps): React.JSX.Element {
  // Pedido do usuário (2026-09-25): a tela abre já marcada na última
  // combinação Resolução + FPS com que a pessoa REALMENTE transmitiu
  // (ver lastTransmissionQuality.ts). Lido uma vez só, na montagem — o
  // `useState(fn)` passa a FUNÇÃO, então ela não roda a cada render; e
  // um `useState` separado guardando o resultado evita ler o disco duas
  // vezes pra alimentar os dois pills.
  const [savedQuality] = useState(loadLastQuality)
  const [resolution, setResolution] = useState<Resolution>(savedQuality.resolution)
  const [fps, setFps] = useState<Fps>(savedQuality.fps)
  const [starting, setStarting] = useState(false)

  const [sourceType, setSourceType] = useState<'screen' | 'window'>('screen')
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourceId, setSourceId] = useState<string | null>(null)
  // Switch "Transmissão privada" (2026-09-10, substituiu o PIN de sala;
  // era checkbox até 2026-09-11). Ligado = a live não aparece na lista de
  // ninguém e só entra quem o host convidar.
  const [isPrivate, setIsPrivate] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadSources(): Promise<void> {
      setLoadingSources(true)
      const list = await window.api.screenCapture.listSources()
      if (cancelled) return

      setSources(list)
      setLoadingSources(false)

      // Sem seleção ainda (primeira carga): escolhe a primeira fonte do
      // tipo que já vem selecionado por padrão ("screen").
      setSourceId((current) => {
        if (current && list.some((source) => source.id === current)) return current
        return list.find((source) => source.type === 'screen')?.id ?? null
      })
    }

    loadSources()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredSources = sources.filter((source) => source.type === sourceType)

  function handleSelectType(type: 'screen' | 'window'): void {
    setSourceType(type)
    const firstOfType = sources.find((source) => source.type === type)
    setSourceId(firstOfType?.id ?? null)
  }

  async function handleStart(): Promise<void> {
    setStarting(true)
    const started = await onStart({ resolution, fps, sourceId, private: isPrivate })
    // Só grava quando a live entrou no ar de verdade: se `onStart`
    // falhou, a pessoa continua nesta tela e nada foi "usado" ainda.
    if (started) saveLastQuality({ resolution, fps })
    if (!started) setStarting(false)
    // se deu certo, a tela troca pra Home (ver App.tsx) — não precisa
    // desarmar "starting" nesse caso, o componente vai desmontar.
  }

  return (
    <div className="transmission-page">
      <header className="transmission-header">
        <button
          type="button"
          className="transmission-back"
          onClick={onBack}
          aria-label="Voltar"
          disabled={starting}
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="transmission-title">
          <Cast size={18} />
          Configurar transmissão
        </h1>
      </header>

      <div className="transmission-toolbar">
        <div className="settings-group">
          <span className="settings-group-label">Resolução</span>
          <div className="pill-group">
            {RESOLUTIONS.map((option) => (
              <button
                type="button"
                key={option}
                className={option === resolution ? 'pill-option pill-option-active' : 'pill-option'}
                onClick={() => setResolution(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-group settings-group-fps">
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

        {/* Privacidade (substituiu o PIN de sala em 2026-09-10; virou
            switch e subiu pra cá em 2026-09-11, a pedido).
            Só vale na hora de CRIAR a sala — trocar resolução/FPS/fonte
            depois não recria a sala, então isso não muda no meio da live.

            `margin-left: auto` no CSS empurra pro canto direito da barra:
            é a única opção da linha que NÃO é um ajuste de qualidade, e
            separá-la fisicamente é o que impede ela de ser lida como
            "mais um pill". */}
        <label className="private-switch">
          <span className="private-switch-text">
            <span className="private-switch-title">
              <Lock size={13} />
              Transmissão privada
              <span className="settings-group-label-optional">(opcional)</span>
            </span>
          </span>
          {/* O <input> fica escondido e o <span> desenha o switch — é o
              mesmo padrão do SettingsModal. Continua sendo um checkbox de
              verdade por baixo, então teclado e leitor de tela funcionam
              sem `role`/`aria` manuais. */}
          <input
            type="checkbox"
            className="private-switch-input"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          <span className="private-switch-track">
            <span className="private-switch-thumb" />
          </span>
        </label>
      </div>

      {/* Fora do <label> e da barra: um aviso que aparece e some muda a
          ALTURA da barra, e a linha de opções dançaria a cada clique.
          Aqui embaixo ele empurra só o conteúdo, que já rola. */}
      {isPrivate && (
        <p className="private-switch-notice">
          <Lock size={14} />
          Sua transmissão será privada e acessível apenas por convite.
        </p>
      )}

      <div className="transmission-content">
        <div className="settings-group-row">
          <div className="settings-group">
            <span className="settings-group-label">Capturar</span>
            <div className="pill-group">
              <button
                type="button"
                className={
                  sourceType === 'screen' ? 'pill-option pill-option-active' : 'pill-option'
                }
                onClick={() => handleSelectType('screen')}
              >
                Monitor inteiro
              </button>
              <button
                type="button"
                className={
                  sourceType === 'window' ? 'pill-option pill-option-active' : 'pill-option'
                }
                onClick={() => handleSelectType('window')}
              >
                Uma janela
              </button>
            </div>
          </div>
        </div>

        <p className="source-hint">
          {sourceType === 'screen'
            ? 'Captura tudo que estiver na tela do monitor escolhido.'
            : 'Captura só a janela escolhida, isolando de outros apps abertos.'}
        </p>

        {/* Pedido do usuário (2026-09-01): o seletor "Capturar"
            (monitor/janela) acima e a dica de texto ficam fixos — só a
            grade de thumbnails rola, num container à parte com o próprio
            scroll (ver .transmission-source-scroll, main.css). */}
        <div className="transmission-source-scroll">
          {loadingSources ? (
            <p className="source-hint">Carregando fontes...</p>
          ) : (
            <div className="source-grid">
              {filteredSources.map((source) => (
                <CaptureSourceCard
                  key={source.id}
                  source={source}
                  selected={source.id === sourceId}
                  onSelect={() => setSourceId(source.id)}
                />
              ))}
              {filteredSources.length === 0 && (
                <p className="source-hint">Nenhuma fonte encontrada.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="transmission-footer">
        <button type="button" className="transmission-cancel" onClick={onBack} disabled={starting}>
          Cancelar
        </button>
        <button
          type="button"
          className="transmission-start"
          onClick={handleStart}
          disabled={starting || !sourceId}
        >
          <Cast size={16} />
          {starting ? 'Iniciando...' : 'Iniciar transmissão'}
        </button>
      </footer>
    </div>
  )
}

export default TransmissionScreen
