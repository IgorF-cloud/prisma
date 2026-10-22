import { ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cast, Lock, Monitor, AppWindow, RefreshCw, SlidersHorizontal, X } from 'lucide-react'
import {
  Fps,
  FPS_OPTIONS,
  nearestFps,
  Resolution,
  RESOLUTIONS,
  TransmissionSettings
} from '../lib/transmissionSettings'
import { loadLastQuality, TransmissionQuality } from '../lib/lastTransmissionQuality'
import CaptureSourceCard, { CaptureSource } from './CaptureSourceCard'
import SourcesLoading from './SourcesLoading'

// O DIALOG DE FONTES (2026-10-16, pedido do usuário)
//
// Substituiu duas coisas que desenhavam quase o mesmo: a tela cheia de
// iniciar live (TransmissionScreen) e o modal de atualizar
// (UpdateTransmissionModal). Agora as duas são este dialog, e só os
// rótulos mudam — ver `LABELS`.
//
// Três decisões do usuário dão a forma dele:
//
//   - TAMANHO FIXO, o mesmo nas duas abas: cabem seis tiles (3 x 2) sem
//     rolar. Trocar de "Tela Inteira" (às vezes uma só) pra "Janelas" (às
//     vezes vinte) não pode fazer a caixa encolher e crescer.
//   - SEM SELEÇÃO E SEM BOTÃO NO RODAPÉ. O hover no tile mostra o botão
//     de ação, e o clique nele já é a escolha: o dialog fecha na hora.
//   - O RODAPÉ é só ajuste: resolução, FPS e sala privada.
//
// Por isso este componente não espera nada: `onPick` é síncrono pra
// ele. Quem chama decide o que acontece depois (ver App.tsx e
// HomeScreen.tsx).

// De quanto em quanto tempo procurar janela nova, enquanto o dialog de
// INICIAR está aberto (2026-10-13). A checagem é a lista SEM miniatura
// (barata), comparando conjuntos de id; só quando uma janela nasce ou
// morre é que a grade é remontada com as miniaturas.
const RECHECAGEM_MS = 2000

// Quanto vale a grade que a Home pré-carregou no hover do botão de
// transmitir (ver `prefetch` em src/main/screenCapture.ts). Vinte
// segundos é o tempo em que uma miniatura ainda descreve a janela.
const GRADE_PRE_CARREGADA_MS = 20000

// Uma miniatura que falha ao decodificar não segura a grade: o `<img>`
// tenta de novo sozinho na pintura, como antes.
function decodificarMiniaturas(list: CaptureSource[]): Promise<unknown> {
  return Promise.all(
    list
      .filter((source) => source.thumbnailDataUrl)
      .map((source) => {
        const img = new Image()
        img.src = source.thumbnailDataUrl
        return img.decode().catch(() => undefined)
      })
  )
}

type Mode = 'start' | 'update'

interface ModeLabels {
  icon: ReactNode
  title: string
  subtitle: string
  actionIcon: ReactNode
  actionLabel: string
  // Só no modo de atualizar: o rótulo do tile que JÁ é a fonte da live
  // (ali o clique aplica resolução/FPS sem trocar de fonte).
  currentActionLabel: string
}

const LABELS: Record<Mode, ModeLabels> = {
  start: {
    icon: <Cast size={18} />,
    title: 'Iniciar live',
    subtitle: 'Escolha o que você quer compartilhar',
    actionIcon: <Cast size={13} />,
    actionLabel: 'Compartilhar tela',
    currentActionLabel: 'Compartilhar tela'
  },
  update: {
    icon: <SlidersHorizontal size={18} />,
    title: 'Atualizar live',
    subtitle: 'Troque a fonte, a resolução ou o FPS sem encerrar a live',
    actionIcon: <RefreshCw size={13} />,
    actionLabel: 'Usar esta fonte',
    currentActionLabel: 'Aplicar mudanças'
  }
}

interface SourcePickerDialogProps {
  mode: Mode
  // A qualidade com que o dialog abre. Sem ela (o dialog de iniciar),
  // abre na última combinação com que a pessoa REALMENTE transmitiu
  // (2026-09-25, ver lastTransmissionQuality.ts).
  initialQuality?: TransmissionQuality
  initialPrivate: boolean
  // A sala já existe (a webcam abriu, 2026-10-20 — item 26): a tela entra
  // nela, e a privacidade é a da sala. O switch aparece travado, como no
  // modo de atualizar.
  privateLocked?: boolean
  // A fonte da live no ar (modo de atualizar): abre na aba dela e com o
  // selo "Transmitindo".
  currentSourceId?: string | null
  onClose: () => void
  onPick: (settings: TransmissionSettings, source: CaptureSource) => void
  // O seletor ÚNICO (2026-10-22): a chave "Tela | Vídeo" no topo, e
  // `instant` quando a janela entrou por ela (sem a animação de abrir) —
  // ver TransmitKindSwitch.
  kindSwitch?: React.ReactNode
  instant?: boolean
  // A sala privada é UMA escolha pras duas abas do seletor — quem guarda é
  // o App (ver `picker.isPrivate`), avisado a cada troca.
  onPrivateChange?: (isPrivate: boolean) => void
}

function SourcePickerDialog({
  mode,
  initialQuality,
  initialPrivate,
  privateLocked = false,
  currentSourceId = null,
  onClose,
  onPick,
  kindSwitch = null,
  instant = false,
  onPrivateChange
}: SourcePickerDialogProps): React.JSX.Element {
  const labels = LABELS[mode]
  const switchLocked = mode === 'update' || privateLocked

  // Lido uma vez só, na montagem — o `useState(fn)` não roda a cada
  // render.
  const [quality] = useState(() => initialQuality ?? loadLastQuality())
  const [resolution, setResolution] = useState<Resolution>(quality.resolution)
  const [fpsEscolhido, setFps] = useState<Fps>(quality.fps)
  // Só vale na hora de CRIAR a sala — trocar resolução/FPS/fonte depois
  // não recria a sala, então no modo de atualizar o switch só mostra o
  // que está valendo.
  const [isPrivate, setIsPrivate] = useState(initialPrivate)

  const [sourceType, setSourceType] = useState<'screen' | 'window'>('screen')
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [loadingSources, setLoadingSources] = useState(true)

  // A lista mais recente, pra checagem periódica comparar sem entrar nas
  // dependências do efeito (que monta uma vez só).
  const sourcesRef = useRef<CaptureSource[]>([])

  useEffect(() => {
    let cancelled = false
    let checando = false
    let temLista = false

    function aplicar(list: CaptureSource[]): void {
      sourcesRef.current = list
      setSources(list)
    }

    // UMA CARGA SÓ, COMPLETA (2026-10-13): a tentativa de carregar em
    // duas etapas foi desfeita no mesmo dia, a pedido do usuário — as
    // miniaturas preenchendo depois da grade montada ficaram estranhas
    // de ver, e adiantavam ~165ms.
    async function carregar(): Promise<void> {
      const list = await window.api.screenCapture.listSources(
        mode === 'start' ? { maxAgeMs: GRADE_PRE_CARREGADA_MS } : undefined
      )
      if (cancelled) return
      aplicar(list)
      temLista = true
      setLoadingSources(false)
      // Abre na aba da fonte que está no ar, quando ela está na lista.
      const current = list.find((source) => source.id === currentSourceId)
      if (current) setSourceType(current.type)
    }

    async function procurarJanelaNova(): Promise<void> {
      if (checando || !temLista) return
      checando = true
      try {
        const agora = await window.api.screenCapture.listSources({ thumbnails: false })
        if (cancelled) return

        // Compara CONJUNTOS de id: o id de uma janela é o HWND dela, então
        // trocar de título ou de posição não remonta nada.
        const antes = sourcesRef.current
        const mesmos =
          antes.length === agora.length &&
          agora.every((source) => antes.some((anterior) => anterior.id === source.id))
        if (mesmos) return

        const completa = await window.api.screenCapture.listSources()
        if (cancelled) return
        // Decodifica as miniaturas novas ANTES de trocar a grade
        // (2026-10-17): o `decode()` roda fora da thread principal, e a
        // grade troca já com tudo pronto pra pintar. Sem isto, as vinte
        // imagens eram decodificadas na hora da pintura, na thread que
        // também rola a lista — a travadinha que o usuário sentia ao rolar
        // durante a atualização.
        await decodificarMiniaturas(completa)
        if (cancelled) return
        aplicar(completa)
      } finally {
        checando = false
      }
    }

    void carregar()
    // Sem a recarga no modo de atualizar: ali já existe uma live no ar, e
    // varrer janela em segundo plano é trabalho tirado de quem transmite.
    const timer =
      mode === 'start' ? setInterval(() => void procurarJanelaNova(), RECHECAGEM_MS) : null

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
    // Monta uma vez: o modo e a fonte atual não mudam com o dialog aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc fecha, como em qualquer dialog.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // FPS FIXO EM 30 E 60 DE NOVO (rollback, 2026-10-17)
  //
  // Entre 2026-10-09 e esta data as opções saíam da taxa do monitor (24 e
  // 48 num de 144 Hz, ver `fpsOptionsFor` em transmissionSettings.ts).
  // Saiu na investigação de lives congelando a cada segundo em dois
  // usuários, um deles a 48 FPS num monitor de 144 Hz — sem causa
  // confirmada, as mudanças do caminho do vídeo da 1.4.0 voltaram juntas.
  //
  // Havia também um defeito próprio aqui: o rodapé mostrava as opções do
  // PRIMEIRO monitor, e no clique o FPS era refeito pela fonte clicada.
  // Uma janela, com monitores de taxas diferentes, não tem taxa — e o 48
  // escolhido virava 60 calado. Foi o que fez o teste do usuário a 144 Hz
  // rodar a 60 e não reproduzir o problema.
  //
  // Um 48 gravado como "última qualidade" por aquela versão cai no degrau
  // mais próximo (60), em vez de mandar pro pipeline um FPS fora da lista.
  const fpsOptions = FPS_OPTIONS
  const fps = fpsOptions.includes(fpsEscolhido)
    ? fpsEscolhido
    : nearestFps(fpsOptions, fpsEscolhido)

  const screens = sources.filter((source) => source.type === 'screen')
  const windows = sources.filter((source) => source.type === 'window')
  const visibleSources = sourceType === 'screen' ? screens : windows

  function handlePick(source: CaptureSource): void {
    onPick({ resolution, fps, sourceId: source.id, private: isPrivate }, source)
  }

  // Num portal, direto no <body>: o dialog de atualizar é montado dentro
  // do rodapé da Home, e ali o `position: fixed` do fundo ficaria preso
  // no empilhamento do rodapé — partes da Home pintariam por cima dele.
  return createPortal(
    <div
      className={`modal-backdrop source-picker-backdrop${instant ? ' modal-instant' : ''}`}
      onClick={onClose}
    >
      <div
        className="source-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={kindSwitch ? undefined : 'source-picker-title'}
        aria-label={kindSwitch ? 'Escolher o que transmitir' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* O CABEÇALHO (2026-10-22, pedido do usuário): a escolha de O QUE
            transmitir — a chave "Tela | Vídeo" — quando o seletor é o
            único da barra; sozinho (o "Adicionar" do rodapé, ou atualizar a
            live), o título de sempre. Embaixo, a escolha de QUAL tela. */}
        <header className="source-picker-header picker-header">
          {kindSwitch ?? (
            <>
              <div className="settings-modal-heading">
                <span className="settings-modal-icon">{labels.icon}</span>
                <div className="settings-modal-titles">
                  <h2 id="source-picker-title" className="settings-modal-title">
                    {labels.title}
                  </h2>
                  <p className="settings-modal-subtitle">{labels.subtitle}</p>
                </div>
              </div>
            </>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="source-picker-subbar">
          <span className="source-picker-subbar-label">
            {sourceType === 'screen' ? 'Escolha o monitor' : 'Escolha a janela'}
          </span>
          <div className="source-picker-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sourceType === 'screen'}
              className={
                sourceType === 'screen'
                  ? 'source-picker-tab source-picker-tab-active'
                  : 'source-picker-tab'
              }
              onClick={() => setSourceType('screen')}
            >
              <Monitor size={15} />
              Tela Inteira
              {!loadingSources && <span className="source-picker-tab-count">{screens.length}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceType === 'window'}
              className={
                sourceType === 'window'
                  ? 'source-picker-tab source-picker-tab-active'
                  : 'source-picker-tab'
              }
              onClick={() => setSourceType('window')}
            >
              <AppWindow size={15} />
              Janelas
              {!loadingSources && <span className="source-picker-tab-count">{windows.length}</span>}
            </button>
          </div>
        </div>

        <div className="source-picker-body">
          {loadingSources ? (
            <SourcesLoading />
          ) : visibleSources.length === 0 ? (
            <div className="source-picker-empty">
              {sourceType === 'screen' ? <Monitor size={28} /> : <AppWindow size={28} />}
              <span className="source-picker-empty-title">
                {sourceType === 'screen' ? 'Nenhuma tela encontrada' : 'Nenhuma janela aberta'}
              </span>
              {sourceType === 'window' && mode === 'start' && (
                <span className="source-picker-empty-hint">
                  Abra o jogo ou o programa — ele aparece aqui sozinho.
                </span>
              )}
            </div>
          ) : (
            // `key` pela aba: a grade nova entra com a própria animação em
            // vez de os tiles trocarem de conteúdo no lugar.
            <div key={sourceType} className="source-picker-grid">
              {visibleSources.map((source) => {
                const current = source.id === currentSourceId
                return (
                  <CaptureSourceCard
                    key={source.id}
                    source={source}
                    current={mode === 'update' && current}
                    actionIcon={labels.actionIcon}
                    actionLabel={current ? labels.currentActionLabel : labels.actionLabel}
                    onAction={() => handlePick(source)}
                  />
                )
              })}
            </div>
          )}
        </div>

        <footer className="source-picker-footer">
          {/* NO COMEÇO do rodapé, no mesmo lugar da janela do vídeo
              (2026-10-22): a sala privada vale pra sala, seja qual for a
              aba. O <input> fica escondido e o <span> desenha o switch — mesmo
              padrão do SettingsModal. Continua sendo um checkbox de
              verdade por baixo, então teclado e leitor de tela funcionam
              sem `role`/`aria` manuais. */}
          <label
            className={switchLocked ? 'private-switch private-switch-locked' : 'private-switch'}
          >
            <span className="private-switch-text">
              <span className="private-switch-title">
                <Lock size={13} />
                Sala privada
              </span>
              <span className="private-switch-description">
                {switchLocked
                  ? 'Definida ao iniciar a live'
                  : isPrivate
                    ? 'Só entra quem você convidar'
                    : 'Aparece pra todo mundo'}
              </span>
            </span>
            <input
              type="checkbox"
              className="private-switch-input"
              checked={isPrivate}
              disabled={switchLocked}
              onChange={(e) => {
                setIsPrivate(e.target.checked)
                onPrivateChange?.(e.target.checked)
              }}
            />
            <span className="private-switch-track">
              <span className="private-switch-thumb" />
            </span>
          </label>

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
              {fpsOptions.map((option) => (
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
        </footer>
      </div>
    </div>,
    document.body
  )
}

export default SourcePickerDialog
