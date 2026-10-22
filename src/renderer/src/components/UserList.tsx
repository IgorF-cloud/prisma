import { Fragment, useCallback, useMemo, useState } from 'react'
import { Pin } from 'lucide-react'
import { AvatarRef } from '../lib/avatar'
import { PresenceMap } from '../lib/useRooms'
import { Friends } from '../lib/useFriends'
import { useFriendsContext } from '../lib/friendActions'
import UserAvatar from './UserAvatar'
import UserCardPopover, { UserCardTarget } from './UserCardPopover'

export interface ListUser {
  id: number
  name: string
  avatar: AvatarRef | null
}

type UserStatus = 'online' | 'busy' | 'offline'

const STATUS_LABEL = { online: 'Online', busy: 'Ocupado', offline: 'Offline' } as const

// Ordem DENTRO de um grupo: disponível antes de ocupado (2026-09-13).
const STATUS_ORDER = { online: 0, busy: 1, offline: 2 } as const

const RELATION_LABEL = {
  friend: 'Amigo',
  outgoing: 'Pedido enviado',
  incoming: 'Quer ser seu amigo'
}

interface Entry {
  user: ListUser
  status: UserStatus
  isPinned: boolean
}

interface UserListProps {
  // Já filtrada por quem chama (sem mim; só amigos, ou todo mundo).
  users: ListUser[]
  apiBaseUrl: string
  // Foto EM TEMPO REAL por nome (broadcast de salas) — ver o comentário
  // do `liveAvatars` em useRooms: a lista buscada é um retrato, e a
  // versão da foto nela envelhece.
  liveAvatars: Record<string, AvatarRef>
  presence: PresenceMap
  friends: Friends
  myViewers: string[]
  // Os fixados vão pro topo e ganham a marca — só na Lista de amigos
  // (decisão do usuário, 2026-10-21). Quem fixa é o mini perfil.
  pinned?: ReadonlySet<number>
  // Mostra a relação comigo na linha de status ("Online · Amigo") — nos
  // Membros, onde amigos e não amigos aparecem juntos.
  showRelation?: boolean
  // Texto quando a lista (já filtrada) vem vazia.
  emptyText: string
}

// A lista de pessoas em ONLINE e OFFLINE (2026-09-25), extraída do
// UsersSidebar em 2026-10-21 (item 26, etapa 6) quando a lista virou
// duas: a Lista de amigos (com fixados) e os Membros (todo mundo).
//
// O tile inteiro abre o MINI PERFIL da pessoa, e é nele que moram as
// ações (fixar, a amizade) desde 2026-10-21 — o botão "Mais" com o menu
// saiu no mesmo dia, a pedido do usuário.
function UserList({
  users,
  apiBaseUrl,
  liveAvatars,
  presence,
  friends,
  myViewers,
  pinned,
  showRelation = false,
  emptyText
}: UserListProps): React.JSX.Element {
  // Quem está AO VIVO (2026-10-22, etapa 8) ganha a tag no tile. A sala
  // sai do mesmo contexto que dá a live ao mini perfil — a lista não
  // recebe as salas por prop.
  const ctx = useFriendsContext()
  const [card, setCard] = useState<UserCardTarget | null>(null)
  const closeCard = useCallback(() => setCard(null), [])

  const avatarOf = useCallback(
    (user: ListUser): AvatarRef | null => liveAvatars[user.name] ?? user.avatar,
    [liveAvatars]
  )

  function handleTileClick(
    event: React.MouseEvent<HTMLButtonElement>,
    user: ListUser,
    status: UserStatus
  ): void {
    // Morre aqui: quem fecha o card é um listener de clique no documento,
    // e sem isto o segundo clique no mesmo tile fecharia e reabriria no
    // mesmo instante.
    event.stopPropagation()
    // Ancora no <li>, que é o retângulo que a pessoa enxerga.
    const tile = event.currentTarget.closest('li') ?? event.currentTarget
    const rect = tile.getBoundingClientRect()
    setCard((current) =>
      current?.name === user.name ? null : { name: user.name, avatar: avatarOf(user), status, rect }
    )
  }

  const groups = useMemo(() => {
    const online: Entry[] = []
    const offline: Entry[] = []
    for (const user of users) {
      const status: UserStatus = presence[user.id] ?? 'offline'
      const entry: Entry = { user, status, isPinned: pinned?.has(user.id) ?? false }
      if (status === 'offline') offline.push(entry)
      else online.push(entry)
    }

    // Fixados primeiro; depois disponível antes de ocupado (entre
    // fixados, só o nome — 2026-09-25); e o nome desempatando o resto.
    function compare(a: Entry, b: Entry): number {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      if (!a.isPinned) {
        const peso = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (peso !== 0) return peso
      }
      return a.user.name.localeCompare(b.user.name, 'pt-BR')
    }
    online.sort(compare)
    offline.sort(compare)

    return [
      { key: 'online' as const, label: 'Online', entries: online },
      { key: 'offline' as const, label: 'Offline', entries: offline }
    ]
  }, [users, presence, pinned])

  if (users.length === 0) {
    return <p className="room-details-empty">{emptyText}</p>
  }

  return (
    <>
      <ul
        className="users-list"
        // A barra de rolagem só aparece com o cursor sobre a lista — por
        // classe no DOM, ver o comentário em main.css.
        onMouseEnter={(e) => e.currentTarget.classList.add('scroll-visible')}
        onMouseLeave={(e) => e.currentTarget.classList.remove('scroll-visible')}
      >
        {groups.map((group) =>
          group.entries.length === 0 ? null : (
            <Fragment key={group.key}>
              <li className="users-group-header" role="presentation">
                <span className="users-group-name">{group.label}</span>
                <span className="users-group-count">- {group.entries.length}</span>
              </li>

              {group.entries.map(({ user, status, isPinned }) => {
                const alreadyWatching = myViewers.includes(user.name)
                const relation = showRelation ? friends.relationOf(user.id) : 'none'
                const isLive = Boolean(ctx?.roomOfHost(user.name))
                return (
                  <li
                    key={user.id}
                    className={`users-list-item${card?.name === user.name ? ' user-tile-active' : ''}${
                      isPinned ? ' users-list-item-pinned' : ''
                    }${isLive ? ' users-list-item-live' : ''}`}
                  >
                    <button
                      type="button"
                      className="user-tile-button"
                      onClick={(event) => handleTileClick(event, user, status)}
                      aria-label={`Ver perfil de ${user.name}`}
                    >
                      <span className="mini-avatar">
                        <UserAvatar avatar={avatarOf(user)} apiBaseUrl={apiBaseUrl} size={14} />
                        <span className={`user-status-dot user-status-${status}`} />
                      </span>

                      <span className="users-list-text">
                        {alreadyWatching && (
                          <span className="users-list-eyebrow">
                            <span className="users-list-watching-dot" />
                            <span className="users-list-eyebrow-text">Assistindo sua live</span>
                          </span>
                        )}
                        <span className="users-list-name">{user.name}</span>
                        <span className="users-list-status">
                          {STATUS_LABEL[status]}
                          {relation !== 'none' && (
                            <span className={`users-list-relation users-list-relation-${relation}`}>
                              {' · '}
                              {RELATION_LABEL[relation]}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>

                    {(isLive || isPinned) && (
                      <span className="users-list-actions">
                        {isLive && (
                          <span className="users-list-live-tag live-snake-ring">
                            <span className="users-list-live-dot" aria-hidden="true" />
                            <span className="users-list-live-label">Live</span>
                          </span>
                        )}
                        {isPinned && (
                          <span className="users-list-pin-mark" aria-hidden="true">
                            <Pin size={13} fill="currentColor" />
                          </span>
                        )}
                      </span>
                    )}
                  </li>
                )
              })}
            </Fragment>
          )
        )}
      </ul>

      {card && <UserCardPopover target={card} apiBaseUrl={apiBaseUrl} onClose={closeCard} />}
    </>
  )
}

export default UserList
