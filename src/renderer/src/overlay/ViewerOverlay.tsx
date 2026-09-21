import { useEffect, useRef, useState } from 'react'
import { AvatarRef } from '../lib/avatar'
import UserAvatar from '../components/UserAvatar'

interface OverlayViewer {
  name: string
  avatar: AvatarRef | null
}

interface OverlayState {
  viewers: OverlayViewer[]
  apiBaseUrl: string
}

// Sobreposição de viewers (2026-09-10) — o conteúdo da janela flutuante
// criada em src/main/overlay.ts.
//
// Roda numa JANELA PRÓPRIA, não dentro da Home: o App.tsx monta isto em
// vez da árvore normal quando a URL tem `#overlay`. Reaproveita o mesmo
// bundle (o Chromium já tem em cache) em vez de um segundo ponto de
// entrada no build.
//
// Não tem estado próprio nem fala com o servidor: recebe tudo pronto do
// main, que por sua vez recebe do renderer principal — que é quem já sabe
// se há live no ar e quem está assistindo.
function ViewerOverlay(): React.JSX.Element {
  const [state, setState] = useState<OverlayState>({ viewers: [], apiBaseUrl: '' })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => window.api.overlay.onState(setState), [])

  // Avisa o main a altura real do conteúdo pra ele encolher a janela.
  // Sem isso a janela ficaria na altura máxima sempre — invisível, por ser
  // transparente, mas ocupando o topo da tela.
  //
  // ResizeObserver e não um cálculo no render: a altura só existe DEPOIS
  // do layout, e ela muda quando um nome longo quebra em duas linhas, não
  // só quando entra ou sai gente.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      window.api.overlay.resize(el.getBoundingClientRect().height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="viewer-overlay">
      <span className="viewer-overlay-live">
        <span className="viewer-overlay-dot" />
        AO VIVO
      </span>

      {state.viewers.length === 0 ? (
        <span className="viewer-overlay-empty">Ninguém assistindo</span>
      ) : (
        <ul className="viewer-overlay-list">
          {state.viewers.map((viewer) => (
            <li key={viewer.name}>
              <span className="mini-avatar viewer-overlay-avatar">
                <UserAvatar avatar={viewer.avatar} apiBaseUrl={state.apiBaseUrl} size={12} />
              </span>
              <span className="viewer-overlay-name">{viewer.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ViewerOverlay
