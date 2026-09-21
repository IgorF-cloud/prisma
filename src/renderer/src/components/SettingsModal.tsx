import { useState, type JSX } from 'react'
import { Bell, MonitorPlay, Settings, X } from 'lucide-react'
import { getErrorMessage } from '../lib/errors'
import { AuthUser } from '../lib/authUser'

interface SettingsModalProps {
  user: AuthUser
  onClose: () => void
  onUserUpdate: (user: AuthUser) => void
}

// Pedido do usuário (2026-09-06): modal CENTRALIZADO (diferente do
// popover de perfil, que é ancorado no tile da sidebar) com as
// preferências da conta. Hoje só uma — o alerta de novas lives —, mas o
// layout já é uma LISTA de linhas pra a segunda entrar sem redesenho:
// cada linha é ícone + título + descrição à esquerda e o controle à
// direita.
//
// Salva otimista: o switch vira na hora e o PUT vai em seguida. Se
// falhar, reverte e mostra o erro — o usuário nunca fica olhando um
// spinner num toggle, que é a parte chata de fazer isso "certo demais"
// pra uma preferência de som.
function SettingsModal({ user, onClose, onUserUpdate }: SettingsModalProps): JSX.Element {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const alertForNewLives = user.settings.alertForNewLives
  const showViewersOverlay = user.settings.showViewersOverlay

  // Uma função pra qualquer preferência booleana (2026-09-10, quando a
  // segunda apareceu): antes era específica do alerta de som, e duplicá-la
  // significaria duplicar também o rollback e o tratamento de erro.
  async function toggleSetting(key: 'alertForNewLives' | 'showViewersOverlay'): Promise<void> {
    if (saving) return
    const previous = user.settings[key]
    const next = !previous
    setError(null)
    setSaving(true)

    // Otimista: reflete já no estado do App (é ele quem alimenta o
    // `user` daqui, o hook de som e a sobreposição), sem esperar a rede.
    onUserUpdate({ ...user, settings: { ...user.settings, [key]: next } })

    try {
      const updated = await window.api.auth.updateSettings(user.id, { [key]: next })
      // Reaplica o que o SERVER devolveu (fonte da verdade) — se ele
      // normalizar algo, a tela acompanha em vez de divergir.
      onUserUpdate(updated)
    } catch (err) {
      onUserUpdate({ ...user, settings: { ...user.settings, [key]: previous } })
      setError(getErrorMessage(err, 'Não foi possível salvar a configuração.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    // Clique no backdrop fecha; o `stopPropagation` no painel impede que
    // um clique DENTRO do modal borbulhe até o backdrop e feche junto.
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Configurações"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-heading">
            <span className="settings-modal-icon">
              <Settings size={18} />
            </span>
            <div className="settings-modal-titles">
              <h2 className="settings-modal-title">Configurações</h2>
              <p className="settings-modal-subtitle">Preferências da sua conta</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar configurações"
          >
            <X size={16} />
          </button>
        </header>

        <div className="settings-modal-body">
          <div className="settings-row">
            <span className="settings-row-icon">
              <Bell size={16} />
            </span>
            <div className="settings-row-text">
              <span className="settings-row-title">Alerta de novas lives</span>
              <span className="settings-row-description">
                Toca um som quando alguém entra ao vivo e a sala aparece na sua lista.
              </span>
            </div>
            {/* <button> com role="switch" em vez de <input type="checkbox">
                — o visual é 100% custom (trilho + bolinha) e o botão já
                traz foco/teclado de graça, sem precisar esconder um input
                nativo por baixo. */}
            <button
              type="button"
              role="switch"
              aria-checked={alertForNewLives}
              className={`settings-switch${alertForNewLives ? ' settings-switch-on' : ''}`}
              onClick={() => toggleSetting('alertForNewLives')}
              disabled={saving}
            >
              <span className="settings-switch-thumb" />
            </button>
          </div>

          <div className="settings-row">
            <span className="settings-row-icon">
              <MonitorPlay size={16} />
            </span>
            <div className="settings-row-text">
              <span className="settings-row-title">Sobreposição de espectadores</span>
              <span className="settings-row-description">
                Mostra quem está assistindo num canto do monitor principal, enquanto você
                transmite. Ela não aparece na transmissão.
              </span>
              {/* Aviso permanente, e não só quando falha: o usuário não
                  tem como adivinhar por que a sobreposição some dentro de
                  um jogo, e a causa (fullscreen exclusivo) não é algo que
                  o app consiga detectar ou contornar. */}
              <span className="settings-row-note">
                Se você joga em tela cheia exclusiva, use o modo Borderless para a
                sobreposição aparecer.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showViewersOverlay}
              className={`settings-switch${showViewersOverlay ? ' settings-switch-on' : ''}`}
              onClick={() => toggleSetting('showViewersOverlay')}
              disabled={saving}
            >
              <span className="settings-switch-thumb" />
            </button>
          </div>

          {error && <p className="auth-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
