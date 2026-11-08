import { useCallback, useMemo, useState } from 'react'
import { Check, ChevronLeft, HeartHandshake, Inbox, X } from 'lucide-react'
import UserGroupIcon from './UserGroupIcon'
import { AvatarRef } from '../lib/avatar'
import { PresenceMap } from '../lib/useRooms'
import { Friends } from '../lib/useFriends'
import { friendActions } from '../lib/friendActions'
import UserAvatar from './UserAvatar'
import UserCardPopover, { UserCardTarget } from './UserCardPopover'
import UserList, { ListUser } from './UserList'

interface FriendsSidebarProps {
  apiBaseUrl: string
  // O diretório inteiro (useUsersDirectory, na HomeScreen); daqui saem
  // os amigos e quem mandou/recebeu pedido.
  users: ListUser[]
  loading: boolean
  loadError: string | null
  liveAvatars: Record<string, AvatarRef>
  presence: PresenceMap
  currentUserId: number
  pinned: ReadonlySet<number>
  friends: Friends
  myViewers: string[]
  onOpenMembers: () => void
  onClose: () => void
  onNotify: (message: string, isError?: boolean) => void
}

type Tab = 'friends' | 'requests'

// LISTA DE AMIGOS (2026-10-21, item 26 / etapa 6) — o painel que era a
// lista de "Usuários". Duas abas:
//
//   - Amigos: só os amigos, com o desenho de sempre (Online/Offline,
//     ocupado, fixados no topo, "Assistindo sua live"). FIXAR só existe
//     aqui (decisão do usuário).
//   - Pedidos: os recebidos (Aceitar/Recusar no próprio tile) e os que
//     eu mandei (Cancelar). Um pedido fica aqui até ser respondido — a
//     notificação dele (etapa 8) tem prazo, o pedido não.
//
// Adicionar gente nova é pelos MEMBROS (a lista de todo mundo, na
// direita) ou pelo card de perfil.
function FriendsSidebar({
  apiBaseUrl,
  users,
  loading,
  loadError,
  liveAvatars,
  presence,
  currentUserId,
  pinned,
  friends,
  myViewers,
  onOpenMembers,
  onClose,
  onNotify
}: FriendsSidebarProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('friends')

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const friendUsers = useMemo(
    () => users.filter((u) => u.id !== currentUserId && friends.friendIds.has(u.id)),
    [users, currentUserId, friends.friendIds]
  )
  // Um pedido de alguém que o diretório ainda não conhece (conta criada
  // depois da última busca) fica de fora até a lista recarregar — o
  // diretório revalida sozinho ao abrir o painel.
  const incoming = friends.incomingIds.flatMap((id) => byId.get(id) ?? [])
  const outgoing = friends.outgoingIds.flatMap((id) => byId.get(id) ?? [])

  return (
    <aside className="side-panel friends-panel">
      <div className="side-panel-header">
        <div className="side-panel-heading">
          <span className="side-panel-title">Lista de amigos</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar lista de amigos"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <div className="panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'friends'}
          className={`panel-tab${tab === 'friends' ? ' panel-tab-active' : ''}`}
          onClick={() => setTab('friends')}
        >
          Todos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'requests'}
          className={`panel-tab${tab === 'requests' ? ' panel-tab-active' : ''}`}
          onClick={() => setTab('requests')}
        >
          Pendentes
          {/* Só os RECEBIDOS contam: é o que espera uma resposta minha. */}
          {incoming.length > 0 && (
            <span className="panel-tab-count panel-tab-count-alert">{incoming.length}</span>
          )}
        </button>
      </div>

      {loading ? (
        <p className="room-details-empty">Carregando...</p>
      ) : loadError ? (
        <p className="auth-error">{loadError}</p>
      ) : tab === 'friends' ? (
        friendUsers.length === 0 ? (
          <PanelEmpty
            icon={<HeartHandshake size={26} />}
            title="Nenhum amigo ainda"
            subtitle="Encontre pessoas nos Membros e mande um pedido de amizade."
            action={{
              label: 'Ver membros',
              icon: <UserGroupIcon size={14} />,
              onClick: onOpenMembers
            }}
          />
        ) : (
          <UserList
            users={friendUsers}
            apiBaseUrl={apiBaseUrl}
            liveAvatars={liveAvatars}
            presence={presence}
            friends={friends}
            myViewers={myViewers}
            pinned={pinned}
            emptyText=""
          />
        )
      ) : incoming.length === 0 && outgoing.length === 0 ? (
        <PanelEmpty
          icon={<Inbox size={26} />}
          title="Nenhum pedido pendente"
          subtitle="Quando alguém pedir sua amizade, o pedido aparece aqui."
        />
      ) : (
        <FriendRequests
          incoming={incoming}
          outgoing={outgoing}
          apiBaseUrl={apiBaseUrl}
          liveAvatars={liveAvatars}
          presence={presence}
          friends={friends}
          onNotify={onNotify}
        />
      )}
    </aside>
  )
}

interface PanelEmptyProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  action?: { label: string; icon: React.ReactNode; onClick: () => void }
}

export function PanelEmpty({ icon, title, subtitle, action }: PanelEmptyProps): React.JSX.Element {
  return (
    <div className="panel-empty">
      <span className="panel-empty-icon">{icon}</span>
      <p className="panel-empty-title">{title}</p>
      <p className="panel-empty-subtitle">{subtitle}</p>
      {action && (
        <button type="button" className="panel-empty-action" onClick={action.onClick}>
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  )
}

interface FriendRequestsProps {
  incoming: ListUser[]
  outgoing: ListUser[]
  apiBaseUrl: string
  liveAvatars: Record<string, AvatarRef>
  presence: PresenceMap
  friends: Friends
  onNotify: (message: string, isError?: boolean) => void
}

// A aba de pedidos. Os botões ficam NO TILE (e não num menu) porque aqui
// responder é a única coisa a fazer — e a pessoa veio pra isso.
function FriendRequests({
  incoming,
  outgoing,
  apiBaseUrl,
  liveAvatars,
  presence,
  friends,
  onNotify
}: FriendRequestsProps): React.JSX.Element {
  const [card, setCard] = useState<UserCardTarget | null>(null)
  const closeCard = useCallback(() => setCard(null), [])
  // Os que estão respondendo agora: o botão não aceita um segundo clique
  // enquanto o primeiro está no servidor.
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set())

  async function respond(user: ListUser, run: () => Promise<void>): Promise<void> {
    setBusy((current) => new Set(current).add(user.id))
    await run()
    setBusy((current) => {
      const next = new Set(current)
      next.delete(user.id)
      return next
    })
  }

  function openCard(event: React.MouseEvent<HTMLButtonElement>, user: ListUser): void {
    event.stopPropagation()
    const rect = (event.currentTarget.closest('li') ?? event.currentTarget).getBoundingClientRect()
    setCard((current) =>
      current?.name === user.name
        ? null
        : {
            name: user.name,
            avatar: liveAvatars[user.name] ?? user.avatar,
            status: presence[user.id] ?? 'offline',
            rect
          }
    )
  }

  function tile(user: ListUser, kind: 'incoming' | 'outgoing'): React.JSX.Element {
    const status = presence[user.id] ?? 'offline'
    const isBusy = busy.has(user.id)
    return (
      <li key={user.id} className="users-list-item friend-request">
        <button
          type="button"
          className="user-tile-button"
          onClick={(event) => openCard(event, user)}
          aria-label={`Ver perfil de ${user.name}`}
        >
          <span className="mini-avatar">
            <UserAvatar
              avatar={liveAvatars[user.name] ?? user.avatar}
              apiBaseUrl={apiBaseUrl}
              size={14}
            />
            <span className={`user-status-dot user-status-${status}`} />
          </span>
          <span className="users-list-text">
            <span className="users-list-name">{user.name}</span>
            <span className="users-list-status">
              {kind === 'incoming' ? 'Quer ser seu amigo' : 'Aguardando resposta'}
            </span>
          </span>
        </button>

        <span className="friend-request-actions">
          {kind === 'incoming' ? (
            <>
              <button
                type="button"
                className="friend-request-button friend-request-accept"
                disabled={isBusy}
                onClick={() => respond(user, () => friendActions.accept(friends, user, onNotify))}
                aria-label={`Aceitar o pedido de ${user.name}`}
                title="Aceitar"
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                className="friend-request-button friend-request-decline"
                disabled={isBusy}
                onClick={() => respond(user, () => friendActions.decline(friends, user, onNotify))}
                aria-label={`Recusar o pedido de ${user.name}`}
                title="Recusar"
              >
                <X size={15} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="friend-request-cancel"
              disabled={isBusy}
              onClick={() => respond(user, () => friendActions.cancel(friends, user, onNotify))}
            >
              Cancelar
            </button>
          )}
        </span>
      </li>
    )
  }

  return (
    <>
      <ul
        className="users-list"
        onMouseEnter={(e) => e.currentTarget.classList.add('scroll-visible')}
        onMouseLeave={(e) => e.currentTarget.classList.remove('scroll-visible')}
      >
        {incoming.length > 0 && (
          <li className="users-group-header" role="presentation">
            <span className="users-group-name">Recebidos</span>
            <span className="users-group-count">- {incoming.length}</span>
          </li>
        )}
        {incoming.map((user) => tile(user, 'incoming'))}
        {outgoing.length > 0 && (
          <li className="users-group-header" role="presentation">
            <span className="users-group-name">Enviados</span>
            <span className="users-group-count">- {outgoing.length}</span>
          </li>
        )}
        {outgoing.map((user) => tile(user, 'outgoing'))}
      </ul>

      {card && <UserCardPopover target={card} apiBaseUrl={apiBaseUrl} onClose={closeCard} />}
    </>
  )
}

export default FriendsSidebar
