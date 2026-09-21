import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type TooltipPlacement = 'right' | 'left' | 'top' | 'bottom'

interface TooltipProps {
  label: ReactNode
  placement?: TooltipPlacement
  // Atraso antes de aparecer. O padrão evita que o tooltip pisque enquanto
  // o mouse só atravessa a área a caminho de outro lugar.
  delayMs?: number
  children: ReactNode
}

// Distância entre o elemento e o balão.
const GAP = 10
// Margem mínima da borda da janela, pra nunca encostar/vazar.
const EDGE = 8

interface Position {
  top: number
  left: number
}

// Tooltip genérico do app (2026-09-09, pedido do usuário) — pra usar em
// qualquer lugar, não só na barra de salas ao vivo.
//
// Renderiza num PORTAL pro <body>, com `position: fixed`, em vez de um
// `position: absolute` dentro do próprio elemento. O motivo é concreto: a
// lista da barra da esquerda tem `overflow-y: auto`, e pelo CSS um
// overflow não-visível num eixo força o outro a recortar também — um
// balão absoluto seria cortado pelos 66px da barra. Fora do fluxo, ele
// escapa de qualquer `overflow` de ancestral.
//
// O preço do portal é que a posição não vem do layout: é calculada do
// `getBoundingClientRect()` do elemento âncora e refeita a cada vez que
// abre. Por isso o tooltip NÃO acompanha scroll/resize enquanto está
// aberto — some no `mouseleave`, e o caso de "rolou a página com o mouse
// parado em cima" fecha junto (ver o listener de scroll abaixo).
function Tooltip({
  label,
  placement = 'right',
  delayMs = 250,
  children
}: TooltipProps): React.JSX.Element {
  const anchorRef = useRef<HTMLSpanElement>(null)
  // Ligado no clique pra impedir o balão de voltar sozinho. Sem isso o
  // `onFocus` desfaz o esconder: a ordem dos eventos é mousedown ->
  // focus -> click, então o focus dispararia `show()` logo depois. Volta
  // a false quando o cursor sai — aí o balão pode reabrir numa próxima
  // passada.
  const suppressedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<Position | null>(null)

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setPosition(null)
  }, [])

  const show = useCallback(() => {
    if (suppressedRef.current) return
    const el = anchorRef.current
    if (!el) return
    // Clicar dispara `focus` logo depois do `mouseenter`, então dá pra
    // entrar aqui duas vezes sem um `hide` no meio. Sem limpar, o primeiro
    // timer sobrevive ao `hide` seguinte (que só conhece o último) e abre o
    // balão com o mouse já longe.
    if (timerRef.current) clearTimeout(timerRef.current)
    const rect = el.getBoundingClientRect()

    // O balão ainda não existe no DOM aqui, então não dá pra medir a
    // largura dele. Em vez de renderizar escondido pra medir, ancora pelo
    // CENTRO do eixo transversal e deixa o `transform` do CSS resolver o
    // deslocamento — funciona com qualquer tamanho de texto.
    let top: number
    let left: number
    if (placement === 'right') {
      top = rect.top + rect.height / 2
      left = rect.right + GAP
    } else if (placement === 'left') {
      top = rect.top + rect.height / 2
      left = rect.left - GAP
    } else if (placement === 'top') {
      top = rect.top - GAP
      left = rect.left + rect.width / 2
    } else {
      top = rect.bottom + GAP
      left = rect.left + rect.width / 2
    }

    // Trava só o eixo em que o balão tem tamanho conhecido (a altura de
    // uma linha); no outro, o `max-width` do CSS já impede de crescer
    // demais.
    top = Math.min(Math.max(top, EDGE), window.innerHeight - EDGE)
    left = Math.min(Math.max(left, EDGE), window.innerWidth - EDGE)

    // `delayMs = 0` abre no mesmo tick, sem passar por `setTimeout` — um
    // timer de 0ms ainda cai no próximo ciclo do event loop, o que se
    // percebe como um atraso de um quadro.
    if (delayMs <= 0) {
      setPosition({ top, left })
      return
    }
    timerRef.current = setTimeout(() => setPosition({ top, left }), delayMs)
  }, [placement, delayMs])

  // Limpa o timer se o componente sair da tela antes de o balão aparecer.
  useEffect(() => hide, [hide])

  // Rolar com o mouse parado em cima moveria o elemento e deixaria o balão
  // "solto" no lugar antigo — `capture` pega o scroll de qualquer
  // ancestral, não só o da janela.
  useEffect(() => {
    if (!position) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [position, hide])

  return (
    <>
      <span
        ref={anchorRef}
        className="tooltip-anchor"
        onMouseEnter={show}
        onMouseLeave={() => {
          suppressedRef.current = false
          hide()
        }}
        // Pedido do usuário (2026-09-09): clicar fecha o balão. No
        // mousedown, não no click — assim ele some junto com o toque, e
        // não depois de a ação já ter acontecido.
        onMouseDown={() => {
          suppressedRef.current = true
          hide()
        }}
        // Teclado: mesmo comportamento do mouse, senão quem navega por Tab
        // nunca vê o texto.
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>

      {position &&
        createPortal(
          <div
            className="tooltip"
            data-placement={placement}
            style={{ top: position.top, left: position.left }}
            role="tooltip"
          >
            {label}
          </div>,
          document.body
        )}
    </>
  )
}

export default Tooltip
