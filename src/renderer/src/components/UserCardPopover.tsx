import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clock, Eye, Pin, PinOff, Radio, UserMinus, UserPlus, X } from 'lucide-react'
import { AvatarRef, customAvatarUrl } from '../lib/avatar'
import { useDismissable } from '../lib/useDismissable'
import { friendActions, FriendsContextValue, useFriendsContext } from '../lib/friendActions'
import UserAvatar from './UserAvatar'
import Tooltip from './Tooltip'
import NowPlayingArt from './NowPlayingArt'

export type UserCardStatus = 'online' | 'busy' | 'offline'

export interface UserCardTarget {
  name: string
  avatar: AvatarRef | null | undefined
  status: UserCardStatus
  // Retângulo do tile que foi clicado, em coordenadas da JANELA
  // (`getBoundingClientRect`) — é o que ancora o card, que é `fixed`.
  //
  // ⚠️ É o retângulo do `<li>`, não o do botão de dentro dele: o botão
  // começa DEPOIS do padding do item, e ancorar nele deixava o card
  // visivelmente mais baixo que o tile realçado (2026-09-13). O card
  // fecha em qualquer scroll (ver useDismissable), então um retângulo
  // velho nunca chega a ser usado.
  rect: DOMRect
}

interface UserCardPopoverProps {
  target: UserCardTarget
  apiBaseUrl: string
  // Como a caixa se alinha ao tile na vertical: 'top' (o topo dos dois
  // junto — o padrão, numa lista que corre de cima pra baixo) ou 'center'
  // (a lista de viewers da MINHA live, que fica num canto da janela). O
  // limite da janela manda nos dois casos — ver o clamp abaixo.
  align?: 'top' | 'center'
  onClose: () => void
}

const STATUS_LABEL: Record<UserCardStatus, string> = {
  online: 'Online',
  busy: 'Ocupado',
  offline: 'Offline'
}

// Folga entre o tile e o card, e margem mínima da borda da janela.
const GAP = 12
const EDGE = 8

// O MINI PERFIL de alguém (2026-09-13; redesenhado em 2026-10-21 a
// pedido do usuário, no desenho da janela de Perfil). Abre ao clicar no
// tile ou no avatar de alguém — nas listas de amigos e membros, na de
// quem assiste uma sala, na da minha live.
//
//   - capa em degradê com a própria foto da pessoa borrada por cima (a
//     mesma ideia da janela de Perfil), e o avatar meio dentro dela;
//   - no canto superior direito, as AÇÕES: fixar e a amizade (adicionar,
//     cancelar o pedido, desfazer em vermelho) — que eram o menu "Mais"
//     das listas até o mesmo dia;
//   - nome, status e a relação comigo;
//   - pedido recebido: Aceitar/Recusar no corpo, com o texto;
//   - a pessoa com uma SALA ABERTA: um tile da live com "Ver", que abre
//     os detalhes da sala dela.
//
// As ações e a live vêm do contexto da Home (FriendsContext), porque o
// card abre de vários lugares e só conhece o NOME. Sem contexto — ou no
// meu próprio card —, ele mostra só a identidade.
//
// Um PORTAL pro <body>: as listas vivem em painéis com `overflow`, que
// recortariam a caixa. Posição calculada do retângulo do tile, com FLIP:
// abre à direita e, se não couber, vai pra esquerda.
function UserCardPopover({
  target,
  apiBaseUrl,
  align = 'top',
  onClose
}: UserCardPopoverProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const ctx = useFriendsContext()

  useDismissable(onClose)

  // A posição é escrita DIRETO no elemento, antes da pintura: ela depende
  // do TAMANHO do card, que só existe depois de renderizar. Por isso ele
  // nasce com `visibility: hidden`.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return

    // `offsetWidth/Height` e NÃO `getBoundingClientRect()`: a entrada é
    // animada com `scale`, e o rect viria transformado.
    const { offsetWidth: width, offsetHeight: height } = el
    const anchor = target.rect

    let left = anchor.right + GAP
    if (left + width > window.innerWidth - EDGE) left = anchor.left - GAP - width
    left = Math.min(Math.max(left, EDGE), window.innerWidth - EDGE - width)

    let top = align === 'top' ? anchor.top : anchor.top + anchor.height / 2 - height / 2
    top = Math.min(Math.max(top, EDGE), window.innerHeight - EDGE - height)

    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = 'visible'
  }, [target, align])

  const id = ctx?.idByName(target.name) ?? null
  const isSelf = id !== null && id === ctx?.selfId
  const live = ctx && !isSelf ? ctx.roomOfHost(target.name) : null
  const photo = target.avatar?.type === 'custom' ? customAvatarUrl(apiBaseUrl, target.avatar) : null

  return createPortal(
    <div
      ref={cardRef}
      className="user-card"
      style={{ visibility: 'hidden' }}
      // O clique DENTRO do card não pode fechá-lo: quem fecha é um
      // listener de `click` no documento.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Perfil de ${target.name}`}
    >
      <div className="user-card-cover">
        {photo && <img className="user-card-cover-photo" src={photo} alt="" />}
        {ctx && id !== null && !isSelf && <UserCardActions ctx={ctx} id={id} name={target.name} />}
      </div>

      <div className="user-card-identity">
        <span className="user-card-avatar-wrapper">
          <span className="user-card-avatar">
            <UserAvatar avatar={target.avatar} apiBaseUrl={apiBaseUrl} size={34} />
          </span>
          {/* Fora do `.user-card-avatar`, que recorta a foto no círculo. */}
          <span className={`user-status-dot user-card-status-dot user-status-${target.status}`} />
        </span>
      </div>

      <div className="user-card-body">
        <span className="user-card-name" title={target.name}>
          {target.name}
        </span>
        <span className="user-card-meta">
          <span className={`user-card-presence user-card-presence-${target.status}`}>
            {STATUS_LABEL[target.status]}
          </span>
          {ctx && id !== null && !isSelf && <UserCardRelation ctx={ctx} id={id} />}
        </span>

        {ctx && id !== null && !isSelf && ctx.friends.relationOf(id) === 'incoming' && (
          <UserCardRequest ctx={ctx} id={id} name={target.name} />
        )}

        {live && ctx && (
          <div className="user-card-live">
            {live.game ? (
              <NowPlayingArt info={live.game} />
            ) : (
              <span className="user-card-live-icon">
                <Radio size={18} />
              </span>
            )}
            <span className="user-card-live-text">
              <span className="user-card-live-badge live-snake-ring">
                <span className="user-card-live-dot" aria-hidden="true" />
                <span className="users-list-live-label">LIVE</span>
              </span>
              <span className="user-card-live-title" title={live.game?.name}>
                {live.game?.name ?? 'Sala aberta'}
              </span>
              <span className="user-card-live-viewers">
                <Eye size={11} />
                {live.viewers} assistindo
              </span>
            </span>
            <button
              type="button"
              className="user-card-live-button"
              onClick={() => {
                ctx.openRoom(live.code)
                onClose()
              }}
            >
              Ver
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// A relação comigo, ao lado do status — um chip pequeno.
function UserCardRelation({
  ctx,
  id
}: {
  ctx: FriendsContextValue
  id: number
}): React.JSX.Element | null {
  switch (ctx.friends.relationOf(id)) {
    case 'friend':
      return <span className="user-card-chip user-card-chip-friend">Amigo</span>
    case 'outgoing':
      return <span className="user-card-chip">Pedido enviado</span>
    case 'incoming':
      return <span className="user-card-chip user-card-chip-incoming">Quer ser seu amigo</span>
    default:
      return null
  }
}

// As AÇÕES do canto da capa: fixar e a amizade, em botões de vidro
// redondos (o mesmo do "fechar" da janela de Perfil).
function UserCardActions({
  ctx,
  id,
  name
}: {
  ctx: FriendsContextValue
  id: number
  name: string
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const { friends, notify } = ctx
  const target = { id, name }
  const relation = friends.relationOf(id)
  const isPinned = ctx.pinned.has(id)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    await action()
    setBusy(false)
  }

  // Fixar é só pra amigo (2026-10-22, pedido do usuário). A exceção é quem
  // JÁ está fixado sem ser amigo (fixou antes de desfazer a amizade): o
  // botão fica, pra ainda dar pra desfixar daqui.
  const canPin = relation === 'friend' || isPinned

  return (
    <div className="user-card-actions">
      {canPin && (
        <Tooltip label={isPinned ? 'Desfixar' : 'Fixar no topo'} placement="top" delayMs={0}>
          <button
            type="button"
            className={`user-card-action${isPinned ? ' user-card-action-on' : ''}`}
            aria-label={isPinned ? `Desfixar ${name}` : `Fixar ${name} no topo`}
            aria-pressed={isPinned}
            onClick={() =>
              void ctx
                .togglePin(id, !isPinned)
                .catch(() =>
                  notify(
                    isPinned
                      ? `Não foi possível desfixar ${name}`
                      : `Não foi possível fixar ${name}`,
                    true
                  )
                )
            }
          >
            {isPinned ? (
              <PinOff size={17} fill="currentColor" />
            ) : (
              <Pin size={17} fill="currentColor" />
            )}
          </button>
        </Tooltip>
      )}

      {relation === 'none' && (
        <Tooltip label="Adicionar amigo" placement="top" delayMs={0}>
          <button
            type="button"
            className="user-card-action user-card-action-add"
            disabled={busy}
            aria-label={`Adicionar ${name} como amigo`}
            onClick={() => run(() => friendActions.request(friends, target, notify))}
          >
            <UserPlus size={17} fill="currentColor" />
          </button>
        </Tooltip>
      )}

      {relation === 'outgoing' && (
        <Tooltip label="Cancelar pedido" placement="top" delayMs={0}>
          <button
            type="button"
            className="user-card-action user-card-action-pending"
            disabled={busy}
            aria-label={`Cancelar o pedido de amizade para ${name}`}
            onClick={() => run(() => friendActions.cancel(friends, target, notify))}
          >
            <Clock size={17} />
          </button>
        </Tooltip>
      )}

      {relation === 'friend' && (
        <Tooltip label="Desfazer amizade" placement="top" delayMs={0}>
          <button
            type="button"
            className="user-card-action user-card-action-remove"
            disabled={busy}
            aria-label={`Desfazer a amizade com ${name}`}
            onClick={() => run(() => friendActions.unfriend(friends, target, notify))}
          >
            <UserMinus size={17} fill="currentColor" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

// Pedido recebido: a resposta mora no corpo, com o texto — é a única coisa
// que a pessoa tem a decidir aqui, e merece mais que um ícone.
function UserCardRequest({
  ctx,
  id,
  name
}: {
  ctx: FriendsContextValue
  id: number
  name: string
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const { friends, notify } = ctx
  const target = { id, name }
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    await action()
    setBusy(false)
  }
  return (
    <div className="user-card-request">
      <span className="user-card-request-text">{name} quer ser seu amigo</span>
      <div className="user-card-request-buttons">
        <button
          type="button"
          className="user-card-request-accept"
          disabled={busy}
          onClick={() => run(() => friendActions.accept(friends, target, notify))}
        >
          <Check size={14} />
          Aceitar
        </button>
        <button
          type="button"
          className="user-card-request-decline"
          disabled={busy}
          onClick={() => run(() => friendActions.decline(friends, target, notify))}
        >
          <X size={14} />
          Recusar
        </button>
      </div>
    </div>
  )
}

export default UserCardPopover
