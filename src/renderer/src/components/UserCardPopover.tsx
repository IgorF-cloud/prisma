import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AvatarRef } from '../lib/avatar'
import { useDismissable } from '../lib/useDismissable'
import UserAvatar from './UserAvatar'

export type UserCardStatus = 'online' | 'busy' | 'offline'

export interface UserCardTarget {
  name: string
  avatar: AvatarRef | null | undefined
  status: UserCardStatus
  // Retângulo do tile que foi clicado, em coordenadas da JANELA
  // (`getBoundingClientRect`) — é o que ancora o card, que é `fixed`.
  //
  // ⚠️ É o retângulo do `<li>`, não o do botão de dentro dele. O botão
  // começa DEPOIS do padding do item (6px no topo, na lista de
  // usuários), e ancorar nele deixava o card visivelmente mais baixo que
  // o tile realçado — foi o "deslocado pra baixo" que o usuário viu em
  // 2026-09-13. O `<li>` é o retângulo que a pessoa enxerga, porque é
  // ele que pinta o fundo do hover.
  //
  // Guardado no estado de quem abre, e não relido aqui: o card fecha em
  // qualquer scroll (ver useDismissable), então um retângulo velho nunca
  // chega a ser usado.
  rect: DOMRect
}

interface UserCardPopoverProps {
  target: UserCardTarget
  apiBaseUrl: string
  // Como a caixa se alinha ao tile na vertical (2026-09-13, pedido do
  // usuário):
  //
  //   'top'    — o topo da caixa encosta no topo do tile. É o padrão,
  //              e é o que parece "preso" ao item clicado numa lista
  //              que corre de cima pra baixo.
  //   'center' — centralizada na altura do tile. Fica pra lista de
  //              viewers da MINHA live, que é uma caixinha no canto
  //              inferior direito da janela: lá o alinhamento pelo topo
  //              não tem o que acompanhar, e a caixa quase sempre
  //              acabaria empurrada pela borda de baixo de qualquer
  //              jeito.
  //
  // Nos dois casos o limite da janela ainda manda — ver o clamp abaixo.
  align?: 'top' | 'center'
  onClose: () => void
}

const STATUS_LABEL: Record<UserCardStatus, string> = {
  online: 'Online',
  busy: 'Ocupado',
  offline: 'Offline'
}

// Folga entre o tile e o card, e margem mínima da borda da janela.
//
// 12px desde 2026-09-13 (era 10, pedido do usuário): com o card alinhado
// pelo topo do tile, uma folga curta demais faz as duas caixas parecerem
// uma coisa só, grudada.
const GAP = 12
const EDGE = 8

// Ficha de um usuário (2026-09-13, pedido do usuário): clicar no tile de
// alguém — na lista de USUÁRIOS, na de viewers de uma sala ou na da
// minha própria live — abre esta caixa com a foto grande, o nome e o
// status.
//
// Um PORTAL pro <body>, pelo mesmo motivo do Tooltip: as três listas
// vivem dentro de painéis com `overflow-y: auto`, e pelo CSS um overflow
// não-visível num eixo força o recorte no outro também. Um card
// posicionado dentro da lista seria cortado pela largura do painel.
//
// Posição calculada do retângulo do tile, com FLIP: abre à direita e,
// se não couber (a lista de viewers da minha live fica no canto direito
// do rodapé), vai pra esquerda.
function UserCardPopover({
  target,
  apiBaseUrl,
  align = 'top',
  onClose
}: UserCardPopoverProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)

  useDismissable(onClose)

  // A posição é escrita DIRETO no elemento, e não por estado.
  //
  // O motivo é que ela depende do TAMANHO do card, que só existe depois
  // de renderizar: guardar num estado significaria renderizar uma vez
  // fora do lugar, medir e renderizar de novo. Escrevendo no
  // `useLayoutEffect` a correção acontece antes da pintura — o card
  // nunca aparece na posição errada, nem por um quadro.
  //
  // Por isso o elemento nasce com `visibility: hidden` no JSX abaixo:
  // ele precisa estar no DOM (pra ter tamanho) sem estar visível.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return

    // `offsetWidth/Height` e NÃO `getBoundingClientRect()`: a caixa entra
    // com uma animação de `scale`, e o rect devolveria o tamanho já
    // transformado (menor, no primeiro quadro) — a conta sairia alguns
    // pixels fora. O offset ignora transform e devolve a caixa de layout.
    const { offsetWidth: width, offsetHeight: height } = el
    const anchor = target.rect

    let left = anchor.right + GAP
    // Não coube à direita: espelha pro outro lado do tile.
    if (left + width > window.innerWidth - EDGE) left = anchor.left - GAP - width
    left = Math.min(Math.max(left, EDGE), window.innerWidth - EDGE - width)

    // Alinhado ao topo do tile ou centrado nele (ver `align`), e em
    // qualquer caso preso dentro da janela: perto do rodapé o clamp puxa
    // a caixa pra cima, senão ela sairia pela borda de baixo.
    let top = align === 'top' ? anchor.top : anchor.top + anchor.height / 2 - height / 2
    top = Math.min(Math.max(top, EDGE), window.innerHeight - EDGE - height)

    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = 'visible'
  }, [target, align])

  return createPortal(
    <div
      ref={cardRef}
      className="user-card"
      style={{ visibility: 'hidden' }}
      // O clique DENTRO do card não pode fechá-lo: quem fecha é um
      // listener de `click` no documento, e parar a propagação aqui
      // impede que o evento chegue lá.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Perfil de ${target.name}`}
    >
      <span className="user-card-avatar-wrapper">
        <span className="user-card-avatar">
          <UserAvatar avatar={target.avatar} apiBaseUrl={apiBaseUrl} size={30} />
        </span>
        {/* Fora do `.user-card-avatar` de propósito: aquele tem
            `overflow: hidden` pra recortar a foto no círculo, e um dot
            lá dentro seria cortado pela borda. Mesmo arranjo do box de
            perfil. */}
        <span className={`user-status-dot user-card-status-dot user-status-${target.status}`} />
      </span>

      <span className="user-card-name" title={target.name}>
        {target.name}
      </span>
      <span className="user-card-status">{STATUS_LABEL[target.status]}</span>
    </div>,
    document.body
  )
}

export default UserCardPopover
