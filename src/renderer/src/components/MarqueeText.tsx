import { useEffect, useRef, useState } from 'react'

interface MarqueeTextProps {
  text: string
  className?: string
}

// Efeito "ping pong" pedido pro nome do jogo/janela no tile da sala (item
// 29 do roadmap) — só anima quando o texto não cabe no espaço disponível
// (mede via scrollWidth x clientWidth do próprio container); texto curto
// fica parado, sem animação à toa. A distância do deslocamento é calculada
// aqui (varia por texto/tile) e passada pro CSS via custom property —
// CSS puro não tem como saber esse valor sozinho.
function MarqueeText({ text, className }: MarqueeTextProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const textEl = textRef.current
    if (!container || !textEl) return

    const measure = (): void => {
      const diff = textEl.scrollWidth - container.clientWidth
      setOverflow(diff > 0 ? diff : 0)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [text])

  return (
    <div className="marquee-container" ref={containerRef}>
      <span
        ref={textRef}
        className={`marquee-text${overflow > 0 ? ' marquee-active' : ''}${className ? ` ${className}` : ''}`}
        style={
          overflow > 0
            ? ({ '--marquee-distance': `${overflow}px` } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  )
}

export default MarqueeText
