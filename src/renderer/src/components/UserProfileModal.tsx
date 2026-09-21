import { ChangeEvent, FormEvent, useRef, useState } from 'react'
import { Check, ChevronRight, Circle, LogOut, Moon, Pencil, Settings, X } from 'lucide-react'
import { hasInvalidUsernameChars, isValidUsername, USERNAME_ERROR_MESSAGE } from '../lib/username'
import { getErrorMessage } from '../lib/errors'
import { compressImageToAvatarWebp } from '../lib/avatar'
import { AuthUser } from '../lib/authUser'
import UserAvatar from './UserAvatar'

interface UserProfileModalProps {
  user: AuthUser
  apiBaseUrl: string
  onClose: () => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
  // Snackbar do App. O upload de foto usa `durationMs: 0` pra
  // mensagem ficar fixa enquanto envia, e depois a repõe com 500ms
  // pra ela sumir sozinha (2026-09-11, pedido do usuário).
  onNotify: (message: string, isError?: boolean, options?: { durationMs?: number }) => void
  // Pedido do usuário (2026-09-06): quem RENDERIZA o modal de
  // configurações é a HomeScreen, não este popover — o modal é
  // centralizado na janela e o popover vive ancorado na sidebar, dentro
  // de um contêiner com `overflow`/`position` próprios. Renderizado aqui
  // dentro, ele herdaria esse contexto e não teria como cobrir a tela.
  onOpenSettings: () => void
}

const AVATAR_FILE_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png'

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
// escurecido) pra um popover ancorado no próprio tile "USER INFO" do
// footer (ver `home-footer-left` em HomeScreen.tsx, que renderiza isso
// como filho seu, posicionado — ver `.profile-popover` em main.css). Sem
// preset de avatar mais (item 43 do roadmap): sem foto customizada, o
// avatar cai direto no roxo padrão do app (`UserAvatar.tsx`), não tem
// mais escolha manual de cor.
// Duas seções, uma coluna:
// - Avatar (clicável, abre o seletor de arquivo) + nome + editar nome
//   (mesmo padrão de textfield+confirmar/cancelar do header).
// - Botão de sair.
function UserProfileModal({
  user,
  apiBaseUrl,
  onClose,
  onUserUpdate,
  onLogout,
  onNotify,
  onOpenSettings
}: UserProfileModalProps): React.JSX.Element {
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(user.name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  // Presença (item 11, 2026-09-10). Só "available"/"busy": offline não é
  // escolha, é consequência de fechar o app — quem decide isso é o
  // servidor, pelo WebSocket estar aberto ou não.
  const [presenceSaving, setPresenceSaving] = useState(false)
  // Submenu de status aberto (2026-09-11). Estado, e não `:hover` no
  // CSS: o bloco também abre por foco de teclado, e CSS puro não
  // consegue manter o submenu aberto enquanto o foco caminha dentro dele.
  const [statusOpen, setStatusOpen] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nameInvalid = hasInvalidUsernameChars(name)

  function startEditing(): void {
    setName(user.name)
    setError(null)
    setEditingName(true)
  }

  function cancelEditing(): void {
    setError(null)
    setEditingName(false)
  }

  function handleNameChange(value: string): void {
    setName(value)
    setError(hasInvalidUsernameChars(value) ? USERNAME_ERROR_MESSAGE : null)
  }

  async function handleSave(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)

    if (!isValidUsername(name)) {
      setError(USERNAME_ERROR_MESSAGE)
      return
    }

    setSaving(true)

    try {
      const updated = await window.api.auth.rename(user.id, name)
      onUserUpdate(updated)
      setEditingName(false)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handlePresence(preference: 'available' | 'busy'): Promise<void> {
    if (preference === user.presence || presenceSaving) return
    setPresenceSaving(true)
    try {
      const updated = await window.api.users.setPresence(user.id, preference)
      onUserUpdate(updated)
    } catch (err) {
      setAvatarError(getErrorMessage(err, 'Não foi possível mudar seu status'))
    } finally {
      setPresenceSaving(false)
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setAvatarError(null)
    setAvatarSaving(true)
    // `durationMs: 0` = fica na tela até ser substituída. Um timer
    // fixo aqui sumiria no meio de um upload lento e a pessoa
    // ficaria sem saber se ainda está enviando.
    onNotify('Enviando foto…', false, { durationMs: 0 })

    try {
      const webpBytes = await compressImageToAvatarWebp(file)
      const updated = await window.api.auth.uploadAvatar(user.id, webpBytes)
      // Atualiza o usuário ANTES de programar o sumiço: é este
      // `onUserUpdate` que troca a foto na tela toda de uma vez (o
      // popover, o avatar do rodapé e — via `version` na URL, que
      // fura o cache — qualquer <img> que aponte pro avatar).
      onUserUpdate(updated)
      // Mesma mensagem, agora com prazo: repor com 500ms reinicia o
      // timer do snackbar e ele sai sozinho meio segundo depois da
      // foto já estar trocada.
      onNotify('Enviando foto…', false, { durationMs: 500 })
    } catch (err) {
      const message = getErrorMessage(err, 'Não foi possível atualizar a foto de perfil')
      setAvatarError(message)
      // Substitui a mensagem fixa — senão o "Enviando foto…"
      // ficaria pendurado pra sempre depois de uma falha.
      onNotify(message, true)
    } finally {
      setAvatarSaving(false)
    }
  }

  // Pedido do usuário (2026-09-04): sem backdrop escurecendo o resto da
  // tela — o "clique fora fecha" é feito por um listener global em
  // HomeScreen.tsx (`homeFooterLeftRef`), não por um backdrop cobrindo a
  // janela toda. `stopPropagation` aqui só evita que um clique dentro do
  // popover borbulhe até o `onClick` (toggle) do tile que o abriu.
  return (
    <div className="profile-popover" onClick={(e) => e.stopPropagation()}>
      <div className="profile-popover-section profile-popover-head">
        <input
          type="file"
          accept={AVATAR_FILE_ACCEPT}
          ref={fileInputRef}
          onChange={handleFileChange}
          hidden
        />
        <div className="profile-popover-identity-row">
          {/* O wrapper existe SÓ pra ancorar o dot de status: o botão
              do avatar tem `overflow: hidden` (pro overlay do lápis
              ficar circular), então um dot dentro dele seria cortado
              ao meio. Ver .profile-popover-avatar-wrapper no CSS. */}
          <span className="profile-popover-avatar-wrapper">
            <button
              type="button"
              className="profile-popover-avatar"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarSaving}
              aria-label="Trocar foto de perfil"
            >
              {/* 28 acompanha o contêiner que foi de 46 pra 56px
                  (2026-09-11) — `size` aqui é só o ÍCONE do placeholder
                  (quem tem foto preenche o círculo inteiro), então
                  deixá-lo em 24 faria o boneco encolher dentro de um
                  círculo maior. */}
              <UserAvatar avatar={user.avatar} apiBaseUrl={apiBaseUrl} size={28} />
              <div className="profile-avatar-overlay">
                <Pencil size={16} />
              </div>
            </button>
            {/* Reusa as classes da lista de usuários pra nunca
                divergir de cor. `available` vira `online`: quem está
                olhando a própria tela está, por definição, com o app
                aberto — não existe se ver como offline. */}
            <span
              className={`user-status-dot profile-avatar-status user-status-${
                user.presence === 'busy' ? 'busy' : 'online'
              }`}
            />
          </span>

          {editingName ? (
            <form className="user-chip-edit-form profile-name-form" onSubmit={handleSave}>
              <input
                type="text"
                className={nameInvalid ? 'input-invalid' : undefined}
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                autoFocus
                required
                disabled={saving}
              />
              <button type="submit" disabled={saving || nameInvalid} aria-label="Salvar nome">
                <Check size={14} />
              </button>
              <button type="button" onClick={cancelEditing} disabled={saving} aria-label="Cancelar">
                <X size={14} />
              </button>
            </form>
          ) : (
            <div className="profile-popover-identity">
              <div className="profile-name-row">
                <span className="profile-name-text">{user.name}</span>
                <button
                  type="button"
                  className="user-chip-icon"
                  onClick={startEditing}
                  aria-label="Editar nome"
                >
                  <Pencil size={14} />
                </button>
              </div>
              {/* E-mail (2026-09-11, pedido do usuário). Só chega aqui
                  porque as rotas do PRÓPRIO usuário passaram a usar
                  `privateUser` no servidor — o GET /users, que lista
                  todo mundo, continua sem e-mail de propósito. */}
              <span className="profile-popover-email" title={user.email}>
                {user.email}
              </span>
              {/* Não há mais texto nenhum aqui (2026-09-11): a dica
                  "clique na foto para trocar" saiu porque o overlay
                  com o lápis já conta essa história, e o "Enviando
                  foto…" virou snackbar no canto inferior esquerdo —
                  ver handleFileChange. */}
            </div>
          )}
        </div>

        {avatarError && <p className="auth-error">{avatarError}</p>}
        {error && <p className="auth-error">{error}</p>}
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
