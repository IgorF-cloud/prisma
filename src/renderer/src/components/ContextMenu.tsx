import { ReactNode, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable } from '../lib/useDismissable'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  // Segunda linha, menor e apagada, embaixo do rótulo. Existe pros itens
  // DESABILITADOS (2026-09-29): um item apagado sem explicação obriga a
  // pessoa a adivinhar o que falta — "Está offline", "Você não está ao
  // vivo". Também serve pra qualificar um item ativo ("Convite já
  // enviado").
  hint?: string
  // Pinta o item de vermelho. Pra ações que tiram algo de alguém —
  // hoje só "Expulsar".
  danger?: boolean
  // Apagado e inerte. `aria-disabled` em vez do atributo `disabled`
  // (2026-09-29): um <button disabled> não dispara nem propaga o clique,
  // e é o clique chegando ao documento que FECHA o menu — o item
  // apagado deixaria o menu pendurado na tela. É também o que a ARIA
  // recomenda pra item de menu: continua alcançável pelo leitor de tela,
  // que anuncia o estado.
  disabled?: boolean
  // Linha de INFORMAÇÃO, não de ação: não é botão, não tem hover e não
  // faz nada. Pro caso em que a ação não existe porque a coisa JÁ
  // aconteceu — "Já assistindo sua live" no lugar de "Convidar".
  info?: boolean
  onSelect?: () => void
}

export interface ContextMenuPosition {
  x: number
  y: number
}

interface ContextMenuProps {
  // Onde o botão direito foi clicado, em coordenadas da janela
  // (`clientX`/`clientY` do evento).
  position: ContextMenuPosition
  items: ContextMenuItem[]
  onClose: () => void
  // 'cursor' (padrão): o menu nasce no ponto, pra baixo e pra direita —
  // o menu de botão direito de sempre.
  // 'beside' (2026-10-21, pedido do usuário pro botão "Mais" das
  // listas): `position` é o canto SUPERIOR DIREITO do botão, e o menu
  // abre AO LADO dele — a borda esquerda do menu na direita do botão,
  // os dois alinhados pelo topo.
  anchor?: 'cursor' | 'beside'
}

const EDGE = 8
// Folga entre o botão e o menu no modo 'beside'.
const BESIDE_GAP = 6

// Menu de botão direito (2026-09-13, pedido do usuário: "Expulsar" na
// lista de viewers da minha live).
//
// Genérico de propósito, mesmo com um item só hoje: o que ele resolve —
// portal, posicionar no cursor sem vazar da janela, fechar em
// clique/Esc/scroll — é igual pra qualquer menu, e o próximo não precisa
// reescrever nada disso.
//
// Não é o menu NATIVO do Electron (`Menu.popup`). Um menu do sistema
// apareceria com a cara do Windows no meio de uma janela sem moldura e
// com estilo próprio, e ainda precisaria de uma ida e volta por IPC pra
// uma decisão que é toda da tela.
function ContextMenu({
  position,
  items,
  onClose,
  anchor = 'cursor'
}: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useDismissable(onClose)

  // Mesma abordagem do UserCardPopover: a posição depende do tamanho do
  // menu, que só existe depois de renderizar. Escrita direto no
  // elemento, antes da pintura — ver o comentário longo lá.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return

    // `offsetWidth/Height` pelo mesmo motivo do UserCardPopover: a
    // animação de entrada usa `scale`, e o rect viria transformado.
    const { offsetWidth: width, offsetHeight: height } = el
    // Abre pra baixo/direita do cursor, como todo menu de contexto; se
    // não couber, espelha pro outro lado em vez de simplesmente encostar
    // na borda — assim o menu nunca cobre o item que foi clicado.
    let left: number
    let top: number
    if (anchor === 'beside') {
      // Ao lado do botão, com uma folga; sem espaço à direita, vai pro
      // outro lado do ponto. Embaixo, sobe só o que faltar.
      left =
        position.x + BESIDE_GAP + width > window.innerWidth - EDGE
          ? Math.max(position.x - width - BESIDE_GAP, EDGE)
          : position.x + BESIDE_GAP
      top = Math.max(Math.min(position.y, window.innerHeight - EDGE - height), EDGE)
    } else {
      left =
        position.x + width > window.innerWidth - EDGE
          ? Math.max(position.x - width, EDGE)
          : position.x
      top =
        position.y + height > window.innerHeight - EDGE
          ? Math.max(position.y - height, EDGE)
          : position.y
    }

    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = 'visible'
  }, [position, anchor])

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ visibility: 'hidden' }}
      role="menu"
      // Botão direito DENTRO do menu não abre outro menu por cima.
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) =>
        item.info ? (
          <div key={item.label} className="context-menu-note" role="presentation">
            {item.icon}
            <span className="context-menu-item-label">
              {item.label}
              {item.hint && <span className="context-menu-item-hint">{item.hint}</span>}
            </span>
          </div>
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`context-menu-item${item.danger ? ' context-menu-item-danger' : ''}${
              item.disabled ? ' context-menu-item-disabled' : ''
            }`}
            aria-disabled={item.disabled || undefined}
            // Sem `stopPropagation` aqui, ao contrário do card: o clique
            // PRECISA chegar ao documento pra fechar o menu. Escolher um
            // item e o menu continuar aberto seria estranho, e daria pra
            // disparar a mesma ação duas vezes.
            //
            // O item apagado também deixa o clique passar — ele só não
            // FAZ nada. Ver `disabled` na interface acima.
            onClick={() => {
              if (item.disabled) return
              item.onSelect?.()
            }}
          >
            {item.icon}
            <span className="context-menu-item-label">
              {item.label}
              {item.hint && <span className="context-menu-item-hint">{item.hint}</span>}
            </span>
          </button>
        )
      )}
    </div>,
    document.body
  )
}

export default ContextMenu
