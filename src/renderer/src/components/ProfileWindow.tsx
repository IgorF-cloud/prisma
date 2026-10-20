import { ChangeEvent, FormEvent, useEffect, useRef, useState, type JSX } from 'react'
import {
  AtSign,
  Camera,
  Check,
  ImagePlay,
  KeyRound,
  Lock,
  Pencil,
  UserRound,
  X
} from 'lucide-react'
import { hasInvalidUsernameChars, isValidUsername, USERNAME_ERROR_MESSAGE } from '../lib/username'
import { getErrorMessage } from '../lib/errors'
import { compressImageToAvatarWebp, customAvatarUrl } from '../lib/avatar'
import { isGifFile, prepareAnimatedAvatar } from '../lib/avatarGif'
import { AuthUser } from '../lib/authUser'
import UserAvatar from './UserAvatar'
import ChangePasswordDialog from './ChangePasswordDialog'

interface ProfileWindowProps {
  user: AuthUser
  apiBaseUrl: string
  onClose: () => void
  onUserUpdate: (user: AuthUser) => void
  onNotify: (message: string, isError?: boolean, options?: { durationMs?: number }) => void
  // Só usado se a senha mudou mas o login automático com a senha nova
  // falhou (ver `auth:resetOwnPassword` no main) — aí a sessão desta
  // janela já foi revogada pelo servidor e não há o que salvar.
  onLogout: () => void
}

// GIF entra desde 2026-10-19 — ver lib/avatarGif.ts.
const AVATAR_FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif'

// Janela de PERFIL (2026-10-19, pedido do usuário). Antes a foto e o
// nome se editavam direto no cabeçalho do popover da barra lateral —
// pequeno, sem explicação, e o lápis era a única pista de que dava pra
// clicar. O popover agora só mostra nome + "Ver perfil" e abre
// isto aqui, que explica cada coisa por extenso.
//
// Renderizada pela HomeScreen, e não pelo popover, pelo mesmo motivo do
// SettingsModal: dentro da barra ela herdaria o `overflow` de lá e não
// conseguiria cobrir a janela.
//
// A troca de senha abre POR CIMA desta janela (ChangePasswordDialog),
// e não no lugar dela: ao terminar ou cancelar, a pessoa volta pro
// perfil de onde saiu.
function ProfileWindow({
  user,
  apiBaseUrl,
  onClose,
  onUserUpdate,
  onNotify,
  onLogout
}: ProfileWindowProps): JSX.Element {
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(user.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSaving, setNameSaving] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nameInvalid = hasInvalidUsernameChars(name)

  // Esc fecha — mas só quando esta é a camada de cima. Com a troca de
  // senha aberta, o Esc é dela; e com o nome em edição, o Esc cancela a
  // edição em vez de jogar fora a janela inteira.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || passwordOpen) return
      if (editingName) {
        setEditingName(false)
        setNameError(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [passwordOpen, editingName, onClose])

  function startEditingName(): void {
    setName(user.name)
    setNameError(null)
    setEditingName(true)
  }

  function cancelEditingName(): void {
    setNameError(null)
    setEditingName(false)
  }

  function handleNameChange(value: string): void {
    setName(value)
    setNameError(hasInvalidUsernameChars(value) ? USERNAME_ERROR_MESSAGE : null)
  }

  async function handleNameSave(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (nameSaving) return
    setNameError(null)

    if (!isValidUsername(name)) {
      setNameError(USERNAME_ERROR_MESSAGE)
      return
    }
    // Salvar o mesmo nome não é erro, só não tem o que mandar.
    if (name === user.name) {
      setEditingName(false)
      return
    }

    setNameSaving(true)
    try {
      const updated = await window.api.auth.rename(user.id, name)
      onUserUpdate(updated)
      setEditingName(false)
      onNotify('Nome atualizado.')
    } catch (err) {
      setNameError(getErrorMessage(err))
    } finally {
      setNameSaving(false)
    }
  }

  // Mesmo fluxo que vivia no popover (comprime no cliente pra WebP
  // 96x96 e manda cru — ver lib/avatar.ts), trazido pra cá junto com a
  // edição. GIF animado vai por outro caminho (lib/avatarGif.ts); um GIF
  // de quadro único cai no da foto parada.
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const gif = isGifFile(file)
    setAvatarError(null)
    setAvatarSaving(true)
    // `durationMs: 0` = fica na tela até ser substituída. Um timer fixo
    // sumiria no meio de um upload lento.
    onNotify(gif ? 'Preparando GIF…' : 'Enviando foto…', false, { durationMs: 0 })

    try {
      const animated = gif ? await prepareAnimatedAvatar(file) : null
      const updated = animated
        ? await window.api.auth.uploadAnimatedAvatar(
            user.id,
            new Uint8Array(await animated.webp.arrayBuffer()),
            new Uint8Array(await animated.gif.arrayBuffer())
          )
        : await window.api.auth.uploadAvatar(user.id, await compressImageToAvatarWebp(file))
      onUserUpdate(updated)
      onNotify('Foto de perfil atualizada.', false, { durationMs: 1500 })
    } catch (err) {
      const message = getErrorMessage(err, 'Não foi possível atualizar a foto de perfil')
      setAvatarError(message)
      onNotify(message, true)
    } finally {
      setAvatarSaving(false)
    }
  }

  function pickAvatar(): void {
    if (!avatarSaving) fileInputRef.current?.click()
  }

  const hasPhoto = user.avatar?.type === 'custom'
  const isAnimated = user.avatar?.type === 'custom' && user.avatar.format === 'gif'

  return (
    <div className="modal-backdrop profile-window-backdrop" onClick={onClose}>
      <div
        className="profile-window"
        role="dialog"
        aria-modal="true"
        aria-label="Seu perfil"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="file"
          accept={AVATAR_FILE_ACCEPT}
          ref={fileInputRef}
          onChange={handleFileChange}
          hidden
        />

        {/* Capa: o gradiente roxo do app e, por cima, a PRÓPRIA foto da
            pessoa borrada — a capa muda de cor junto com o avatar sem
            ninguém precisar escolher nada. Sem foto, fica só o
            gradiente. */}
        <div className="profile-window-cover">
          {hasPhoto && user.avatar?.type === 'custom' && (
            <img
              className="profile-window-cover-photo"
              src={customAvatarUrl(apiBaseUrl, user.avatar)}
              alt=""
            />
          )}
          <span className="profile-window-cover-title">Seu perfil</span>
          <button
            type="button"
            className="profile-window-close"
            onClick={onClose}
            aria-label="Fechar perfil"
          >
            <X size={16} />
          </button>
        </div>

        <div className="profile-window-identity">
          <button
            type="button"
            className="profile-window-avatar"
            onClick={pickAvatar}
            disabled={avatarSaving}
            aria-label="Clique aqui para editar o seu avatar"
          >
            <UserAvatar avatar={user.avatar} apiBaseUrl={apiBaseUrl} size={48} />
            <span className="profile-window-avatar-overlay">
              {avatarSaving ? (
                <span className="profile-window-spinner" />
              ) : (
                <>
                  <Camera size={20} />
                  <span>Editar</span>
                </>
              )}
            </span>
          </button>
          {/* Reusa as classes da lista de usuários pra nunca divergir de
              cor — mesma regra do popover. */}
          <span
            className={`user-status-dot profile-window-status user-status-${
              user.presence === 'busy' ? 'busy' : 'online'
            }`}
          />

          <div className="profile-window-identity-text">
            <h2 className="profile-window-name">{user.name}</h2>
            <span className="profile-window-email">{user.email}</span>
          </div>
        </div>

        <div className="profile-window-body">
          <section className="profile-window-section">
            <h3 className="profile-window-section-title">Informações da conta</h3>

            <button
              type="button"
              className="profile-field profile-field-clickable"
              onClick={pickAvatar}
              disabled={avatarSaving}
            >
              <span className="profile-field-icon">
                <ImagePlay size={16} />
              </span>
              <span className="profile-field-text">
                <span className="profile-field-label">Foto de perfil</span>
                <span className="profile-field-value">
                  {avatarSaving
                    ? 'Enviando…'
                    : isAnimated
                      ? 'GIF animado'
                      : hasPhoto
                        ? 'Foto personalizada'
                        : 'Sem foto (usando a padrão)'}
                </span>
                <span className="profile-field-hint">
                  Clique aqui para editar o seu avatar · JPG, PNG ou GIF
                </span>
              </span>
              <span className="profile-field-action">
                <Pencil size={14} />
              </span>
            </button>
            {avatarError && <p className="auth-error profile-field-error">{avatarError}</p>}

            {editingName ? (
              <form
                className="profile-field profile-field-editing auth-form"
                onSubmit={handleNameSave}
              >
                <span className="profile-field-icon">
                  <UserRound size={16} />
                </span>
                <div className="profile-field-text">
                  <span className="profile-field-label">Nome de usuário</span>
                  <div className="profile-name-edit-row">
                    <input
                      type="text"
                      className={`profile-name-input${nameInvalid ? ' input-invalid' : ''}`}
                      value={name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      aria-label="Novo nome de usuário"
                      autoFocus
                      required
                      disabled={nameSaving}
                    />
                    <button
                      type="submit"
                      className="profile-name-edit-button profile-name-edit-save"
                      disabled={nameSaving || nameInvalid}
                      aria-label="Salvar nome"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      className="profile-name-edit-button"
                      onClick={cancelEditingName}
                      disabled={nameSaving}
                      aria-label="Cancelar"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <span className="profile-field-hint">
                    Só letras e números, sem espaços nem acentos. Enter salva, Esc cancela.
                  </span>
                  {nameError && <p className="auth-error profile-field-error">{nameError}</p>}
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="profile-field profile-field-clickable"
                onClick={startEditingName}
              >
                <span className="profile-field-icon">
                  <UserRound size={16} />
                </span>
                <span className="profile-field-text">
                  <span className="profile-field-label">Nome de usuário</span>
                  <span className="profile-field-value">{user.name}</span>
                  <span className="profile-field-hint">Clique para editar o seu nome</span>
                </span>
                <span className="profile-field-action">
                  <Pencil size={14} />
                </span>
              </button>
            )}

            {/* E-mail não se edita por aqui: é ele que recebe o código da
                troca de senha, e trocá-lo sem confirmar o endereço novo
                abriria a porta pra perder a conta. O cadeado diz isso sem
                precisar de um botão que não faz nada. */}
            <div className="profile-field">
              <span className="profile-field-icon">
                <AtSign size={16} />
              </span>
              <span className="profile-field-text">
                <span className="profile-field-label">E-mail</span>
                <span className="profile-field-value" title={user.email}>
                  {user.email}
                </span>
                <span className="profile-field-hint">
                  Recebe o código de confirmação quando você troca a senha
                </span>
              </span>
              <span className="profile-field-lock" title="O e-mail não pode ser alterado">
                <Lock size={13} />
              </span>
            </div>
          </section>

          <section className="profile-window-section">
            <h3 className="profile-window-section-title">Segurança</h3>

            <div className="profile-field profile-field-security">
              <span className="profile-field-icon">
                <KeyRound size={16} />
              </span>
              <span className="profile-field-text">
                <span className="profile-field-label">Senha</span>
                <span className="profile-field-value profile-field-password">••••••••••</span>
                <span className="profile-field-hint">
                  Enviamos um código para o seu e-mail para confirmar a troca
                </span>
              </span>
              <button
                type="button"
                className="pill-button pill-button-accent profile-password-button"
                onClick={() => setPasswordOpen(true)}
              >
                <KeyRound size={14} />
                Alterar senha
              </button>
            </div>
          </section>
        </div>
      </div>

      {passwordOpen && (
        <ChangePasswordDialog
          user={user}
          onClose={() => setPasswordOpen(false)}
          onUserUpdate={onUserUpdate}
          onNotify={onNotify}
          onLogout={onLogout}
        />
      )}
    </div>
  )
}

export default ProfileWindow
