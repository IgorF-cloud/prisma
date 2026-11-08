import { useMemo, useState } from 'react'
import { ChevronLeft, Search, UserRoundSearch, X } from 'lucide-react'
import { AvatarRef } from '../lib/avatar'
import { PresenceMap } from '../lib/useRooms'
import { Friends } from '../lib/useFriends'
import UserList, { ListUser } from './UserList'
import { PanelEmpty } from './FriendsSidebar'

interface MembersPanelProps {
  apiBaseUrl: string
  users: ListUser[]
  loading: boolean
  loadError: string | null
  liveAvatars: Record<string, AvatarRef>
  presence: PresenceMap
  currentUserId: number
  friends: Friends
  myViewers: string[]
  onClose: () => void
}

// MEMBROS (2026-10-21, item 26 / etapa 6) — TODO mundo que tem conta no
// app. Abre pelo tile logo abaixo da Lista de amigos, no MESMO lugar dela
// e da ficha de sala (um `sidePanel` da HomeScreen). É daqui que se
// adiciona amigos: clicar na pessoa abre o mini perfil, com as ações.
//
// Mesma lista da Lista de Amigos (UserList), sem fixados — fixar é só
// dos amigos (decisão do usuário) — e com a relação comigo na linha de
// status ("Online · Amigo"), porque aqui amigos e não amigos se misturam.
function MembersPanel({
  apiBaseUrl,
  users,
  loading,
  loadError,
  liveAvatars,
  presence,
  currentUserId,
  friends,
  myViewers,
  onClose
}: MembersPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('')

  const others = useMemo(() => users.filter((u) => u.id !== currentUserId), [users, currentUserId])
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pt-BR')
    if (!q) return others
    return others.filter((u) => u.name.toLocaleLowerCase('pt-BR').includes(q))
  }, [others, query])
  const onlineCount = others.filter((u) => presence[u.id]).length

  return (
    <aside className="side-panel members-panel">
      <div className="side-panel-header">
        <div className="side-panel-heading">
          <span className="side-panel-title">Membros</span>
          {!loading && !loadError && (
            <span className="members-panel-summary">
              {others.length} {others.length === 1 ? 'membro' : 'membros'}
              {/* Sem ninguem online, o "· 0 online" some (2026-10-28, pedido do
                  usuario). `others` ja deixa de fora quem esta logado. */}
              {onlineCount > 0 && (
                <>
                  {' · '}
                  <span className="members-panel-online">{onlineCount} online</span>
                </>
              )}
            </span>
          )}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar membros">
          <ChevronLeft size={16} />
        </button>
      </div>

      <label className="panel-search">
        <Search size={14} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar membro"
          spellCheck={false}
          aria-label="Buscar membro"
        />
        {query && (
          <button
            type="button"
            className="panel-search-clear"
            onClick={() => setQuery('')}
            aria-label="Limpar busca"
          >
            <X size={13} />
          </button>
        )}
      </label>

      {loading ? (
        <p className="room-details-empty">Carregando...</p>
      ) : loadError ? (
        <p className="auth-error">{loadError}</p>
      ) : others.length === 0 ? (
        <p className="room-details-empty">Nenhum outro membro cadastrado.</p>
      ) : filtered.length === 0 ? (
        <PanelEmpty
          icon={<UserRoundSearch size={26} />}
          title="Ninguém encontrado"
          subtitle={`Nenhum membro com "${query.trim()}" no nome.`}
        />
      ) : (
        <UserList
          users={filtered}
          apiBaseUrl={apiBaseUrl}
          liveAvatars={liveAvatars}
          presence={presence}
          friends={friends}
          myViewers={myViewers}
          showRelation
          emptyText=""
        />
      )}
    </aside>
  )
}

export default MembersPanel
