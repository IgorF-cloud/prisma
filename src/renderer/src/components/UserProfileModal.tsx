import { useState } from 'react'
import { Check, ChevronRight, Circle, LogOut, Moon, Settings } from 'lucide-react'
import { getErrorMessage } from '../lib/errors'
import { AuthUser } from '../lib/authUser'
import { MyLiveWhere, myLiveTagLabel } from '../lib/myLive'
import UserAvatar from './UserAvatar'

interface UserProfileModalProps {
  user: AuthUser
  apiBaseUrl: string
  onClose: () => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
  // Pedido do usuário (2026-09-06): quem RENDERIZA o modal de
  // configurações é a HomeScreen, não este popover — o modal é
  // centralizado na janela e o popover vive ancorado na sidebar, dentro
  // de um contêiner com `overflow`/`position` próprios. Renderizado aqui
  // dentro, ele herdaria esse contexto e não teria como cobrir a tela.
  onOpenSettings: () => void
  // Janela de perfil (2026-10-19) — mesma razão do `onOpenSettings`:
  // quem renderiza é a HomeScreen. Ver ProfileWindow.tsx.
  onOpenProfile: () => void
  // Onde a minha live está no ar, se estiver (2026-10-28, item 27): a tag
  // "Transmitindo do App/Site" no cabeçalho.
  myLive?: MyLiveWhere | null
}

// As duas preferências de presença, com o ícone que as identifica.
// Numa lista, e não em JSX repetido, porque o mesmo par é renderizado
// em dois lugares: o gatilho (mostra a atual) e o submenu (mostra todas).
//
// "Disponível" e não "Online" (2026-09-11, pedido do usuário): aqui a
// pessoa ESCOLHE uma preferência, e ninguém escolhe estar online — isso
// é consequência de ter o app aberto. Na lista de usuários o rótulo
// continua "Online", porque lá é observação de estado, não escolha.
const PRESENCE_OPTIONS = [
  {
    value: 'available' as const,
    label: 'Disponível',
    icon: <Circle size={9} className="profile-status-dot profile-status-dot-online" />
  },
  {
    value: 'busy' as const,
    label: 'Ocupado',
    icon: <Moon size={11} className="profile-status-dot profile-status-dot-busy" />
  }
]

// Pedido do usuário (2026-09-04): trocou de modal centralizado (backdrop
// escurecido) pra um popover ancorado no avatar da barra lateral.
// Três seções, uma coluna:
// - Cabeçalho: avatar + nome + "Ver perfil", que abre a janela
//   de perfil (2026-10-19 — até então a foto e o nome se editavam aqui).
// - Status (Disponível/Ocupado).
// - Configurações e Sair.
function UserProfileModal({
  user,
  apiBaseUrl,
  onClose,
  onUserUpdate,
  onLogout,
  onOpenSettings,
  onOpenProfile,
  myLive = null
}: UserProfileModalProps): React.JSX.Element {
  // Presença (item 11, 2026-09-10). Só "available"/"busy": offline não é
  // escolha, é consequência de fechar o app — quem decide isso é o
  // servidor, pelo WebSocket estar aberto ou não.
  const [presenceSaving, setPresenceSaving] = useState(false)
  // Submenu de status aberto (2026-09-11). Estado, e não `:hover` no
  // CSS: o bloco também abre por foco de teclado, e CSS puro não
  // consegue manter o submenu aberto enquanto o foco caminha dentro dele.
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  async function handlePresence(preference: 'available' | 'busy'): Promise<void> {
    if (preference === user.presence || presenceSaving) return
    setPresenceSaving(true)
    setStatusError(null)
    try {
      const updated = await window.api.users.setPresence(user.id, preference)
      onUserUpdate(updated)
    } catch (err) {
      setStatusError(getErrorMessage(err, 'Não foi possível mudar seu status'))
    } finally {
      setPresenceSaving(false)
    }
  }

  // Pedido do usuário (2026-09-04): sem backdrop escurecendo o resto da
  // tela — o "clique fora fecha" é feito por um listener global em
  // HomeScreen.tsx (`homeFooterLeftRef`), não por um backdrop cobrindo a
  // janela toda. `stopPropagation` aqui só evita que um clique dentro do
  // popover borbulhe até o `onClick` (toggle) do tile que o abriu.
  return (
    <div className="profile-popover" onClick={(e) => e.stopPropagation()}>
      {/* Cabeçalho (2026-10-19, pedido do usuário): deixou de editar
          foto e nome aqui mesmo. Virou UM botão — avatar, nome e
          "Ver perfil" — que abre a janela de perfil, onde cada
          coisa é explicada por extenso. O e-mail saiu daqui junto: ele
          mora na janela agora. */}
      <div className="profile-popover-section profile-popover-head">
        {/* EU AO VIVO (pedido do usuário, 2026-10-28): de onde a live está
            saindo — o app ou o site. Linha própria, no topo do cabeçalho. */}
        {myLive && (
          <span className="profile-live-tag">
            <span className="profile-live-tag-dot" aria-hidden="true" />
            {myLiveTagLabel(myLive)}
          </span>
        )}
        <button
          type="button"
          className="profile-popover-identity-row profile-popover-open"
          onClick={() => {
            onClose()
            onOpenProfile()
          }}
        >
          {/* O wrapper existe SÓ pra ancorar o dot de status: o círculo
              do avatar tem `overflow: hidden`, e um dot dentro dele
              seria cortado ao meio. */}
          <span className="profile-popover-avatar-wrapper">
            <span className="profile-popover-avatar">
              <UserAvatar avatar={user.avatar} apiBaseUrl={apiBaseUrl} size={28} />
            </span>
            {/* `available` vira `online`: quem está olhando a própria
                tela está, por definição, com o app aberto. */}
            <span
              className={`user-status-dot profile-avatar-status user-status-${
                user.presence === 'busy' ? 'busy' : 'online'
              }`}
            />
          </span>

          <span className="profile-popover-identity">
            <span className="profile-name-text">{user.name}</span>
            <span className="profile-popover-edit-hint">Ver perfil</span>
          </span>

          <ChevronRight size={16} className="profile-popover-open-chevron" />
        </button>

        {statusError && <p className="auth-error">{statusError}</p>}
      </div>

      {/* Status (2026-09-11, pedido do usuário): era uma linha com os
          dois botões lado a lado; virou UMA linha que mostra o estado
          atual e abre as opções num submenu à direita, no hover.

          "Disponível" no lugar de "Online" — o próprio usuário está
          ESCOLHENDO uma preferência, e ninguém escolhe "estar online":
          isso é consequência de ter o app aberto. A lista dos outros
          continua dizendo "Online", porque lá é observação, não escolha.

          "Offline" não aparece aqui de propósito: ficar offline é
          fechar o app, e um botão que não desconecta nada seria mentira.

          `onFocus`/`onBlur` junto do mouse pra funcionar por teclado —
          o submenu é a ÚNICA forma de trocar o status, então perdê-lo
          no teclado tornaria a função inacessível. */}
      <div
        className="profile-popover-section profile-status-section"
        onMouseEnter={() => setStatusOpen(true)}
        onMouseLeave={() => setStatusOpen(false)}
        onFocus={() => setStatusOpen(true)}
        onBlur={(e) => {
          // Só fecha quando o foco sai do bloco INTEIRO — sem isso,
          // andar de um botão pro outro com Tab fecharia o submenu.
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setStatusOpen(false)
        }}
      >
        <button
          type="button"
          className="profile-status-trigger"
          aria-haspopup="menu"
          aria-expanded={statusOpen}
          disabled={presenceSaving}
        >
          {PRESENCE_OPTIONS.find((o) => o.value === user.presence)?.icon}
          <span className="profile-status-trigger-label">
            {PRESENCE_OPTIONS.find((o) => o.value === user.presence)?.label ?? 'Status'}
          </span>
          <ChevronRight size={14} className="profile-status-chevron" />
        </button>

        {statusOpen && (
          <div className="profile-status-menu" role="menu">
            {PRESENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={user.presence === option.value}
                className={`profile-status-option${
                  user.presence === option.value ? ' profile-status-option-on' : ''
                }`}
                onClick={() => handlePresence(option.value)}
                disabled={presenceSaving}
              >
                {option.icon}
                <span>{option.label}</span>
                {user.presence === option.value && (
                  <Check size={13} className="profile-status-check" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="profile-popover-section profile-popover-logout-section">
        {/* Fecha o popover ao abrir o modal — os dois abertos ao mesmo
            tempo deixariam o popover aparecendo por trás do backdrop. */}
        <button
          type="button"
          className="profile-popover-action"
          onClick={() => {
            onClose()
            onOpenSettings()
          }}
        >
          <Settings size={16} />
          <span>Configurações</span>
        </button>

        <button
          type="button"
          className="profile-popover-action profile-popover-logout"
          onClick={() => {
            onClose()
            onLogout()
          }}
        >
          <LogOut size={16} />
          <span>Sair</span>
        </button>
      </div>
    </div>
  )
}

export default UserProfileModal
