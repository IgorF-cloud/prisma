import { useState, type JSX } from 'react'
import { Bell, BellOff, Check, Globe, Loader2, MonitorPlay, Settings, TriangleAlert, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getErrorMessage } from '../lib/errors'
import { AuthUser, NewLiveAlerts, UserSettings, newLiveAlertsOf } from '../lib/authUser'

const NEW_LIVE_ALERT_CHOICES: {
  value: NewLiveAlerts
  label: string
  hint: string
  icon: LucideIcon
}[] = [
  {
    value: 'all',
    label: 'Todas',
    hint: 'Lives públicas de todo mundo e as privadas dos seus amigos.',
    icon: Globe
  },
  {
    value: 'friends',
    label: 'Somente amigos',
    hint: 'Só as lives dos seus amigos, públicas ou privadas.',
    icon: Users
  },
  { value: 'none', label: 'Nenhuma', hint: 'Nenhum alerta de live, nem de amigos.', icon: BellOff }
]

interface SettingsModalProps {
  user: AuthUser
  onClose: () => void
  onUserUpdate: (user: AuthUser) => void
}

// Pedido do usuário (2026-09-06): modal CENTRALIZADO (diferente do
// popover de perfil, que é ancorado no tile da sidebar) com as
// preferências da conta.
//
// Redesenho (2026-10-22, pedido do usuário): mais largo, com as
// preferências agrupadas em SEÇÕES (Notificações, Transmissão) e o
// alerta de novas lives como três cartões lado a lado, cada um com a
// própria explicação — antes só a opção marcada mostrava a dica, e era
// preciso clicar pra descobrir o que as outras faziam. Mesma linguagem
// visual do WebcamPickerDialog/SourcePickerDialog.
//
// Salva otimista: a escolha vira na hora e o PUT vai em seguida. Se
// falhar, reverte e mostra o erro — o usuário nunca fica olhando um
// spinner num toggle, que é a parte chata de fazer isso "certo demais"
// pra uma preferência de som.
function SettingsModal({ user, onClose, onUserUpdate }: SettingsModalProps): JSX.Element {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const newLiveAlerts = newLiveAlertsOf(user.settings)
  const showViewersOverlay = user.settings.showViewersOverlay

  // Uma função pra qualquer preferência (2026-09-10, quando a segunda
  // apareceu): antes era específica do alerta de som, e duplicá-la
  // significaria duplicar também o rollback e o tratamento de erro.
  async function saveSettings(patch: Partial<UserSettings>): Promise<void> {
    if (saving) return
    const previous = user.settings
    setError(null)
    setSaved(false)
    setSaving(true)

    // Otimista: reflete já no estado do App (é ele quem alimenta o
    // `user` daqui, os alertas e a sobreposição), sem esperar a rede.
    onUserUpdate({ ...user, settings: { ...previous, ...patch } })

    try {
      const updated = await window.api.auth.updateSettings(user.id, patch)
      // Reaplica o que o SERVER devolveu (fonte da verdade) — se ele
      // normalizar algo, a tela acompanha em vez de divergir.
      onUserUpdate(updated)
      setSaved(true)
    } catch (err) {
      onUserUpdate({ ...user, settings: previous })
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
              <Settings size={20} />
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
            <X size={18} />
          </button>
        </header>

        <div className="settings-modal-body">
          <section className="settings-section">
            <h3 className="settings-section-label">Notificações</h3>

            <div className="settings-row">
              <div className="settings-row-head">
                <span className="settings-row-icon">
                  <Bell size={18} />
                </span>
                <div className="settings-row-text">
                  <span className="settings-row-title">Alerta de novas lives</span>
                  <span className="settings-row-description">
                    Quando alguém inicia uma live: um som, um aviso no canto do app e o destaque na
                    barra de tarefas.
                  </span>
                </div>
              </div>

              {/* A escolha em três (etapa 8, 2026-10-22) — era um liga/desliga.
                  Cartões com a explicação de cada um à vista. */}
              <div className="settings-choice" role="radiogroup" aria-label="Alerta de novas lives">
                {NEW_LIVE_ALERT_CHOICES.map((choice) => {
                  const on = newLiveAlerts === choice.value
                  const Icon = choice.icon
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`settings-choice-option${on ? ' settings-choice-option-on' : ''}`}
                      onClick={() => {
                        if (!on) void saveSettings({ newLiveAlerts: choice.value })
                      }}
                      disabled={saving}
                    >
                      <span className="settings-choice-top">
                        <span className="settings-choice-icon">
                          <Icon size={15} />
                        </span>
                        <span className="settings-choice-radio" aria-hidden="true">
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                      </span>
                      <span className="settings-choice-label">{choice.label}</span>
                      <span className="settings-choice-hint">{choice.hint}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-label">Transmissão</h3>

            <div className="settings-row">
              <div className="settings-row-head">
                <span className="settings-row-icon">
                  <MonitorPlay size={18} />
                </span>
                <div className="settings-row-text">
                  <span className="settings-row-title">Sobreposição de espectadores</span>
                  <span className="settings-row-description">
                    Mostra quem está assistindo num canto do monitor principal, enquanto você
                    transmite. Ela não aparece na transmissão.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showViewersOverlay}
                  aria-label="Sobreposição de espectadores"
                  className={`settings-switch${showViewersOverlay ? ' settings-switch-on' : ''}`}
                  onClick={() => saveSettings({ showViewersOverlay: !showViewersOverlay })}
                  disabled={saving}
                >
                  <span className="settings-switch-thumb" />
                </button>
              </div>

              {/* Aviso permanente, e não só quando falha: o usuário não
                  tem como adivinhar por que a sobreposição some dentro de
                  um jogo, e a causa (fullscreen exclusivo) não é algo que
                  o app consiga detectar ou contornar. */}
              <div className="settings-row-note">
                <TriangleAlert size={15} />
                <span>
                  Se você joga em tela cheia exclusiva, use o modo <strong>Borderless</strong> para
                  a sobreposição aparecer.
                </span>
              </div>
            </div>
          </section>

          {error && <p className="auth-error">{error}</p>}
        </div>

        <footer className="settings-modal-footer">
          <span
            className={`settings-save-state${saving ? ' settings-save-state-busy' : ''}`}
            aria-live="polite"
          >
            {saving ? (
              <>
                <Loader2 size={13} className="settings-save-spin" />
                Salvando…
              </>
            ) : saved ? (
              <>
                <Check size={13} />
                Salvo
              </>
            ) : (
              'As alterações são salvas automaticamente'
            )}
          </span>
          <button type="button" className="settings-done" onClick={onClose}>
            Concluir
          </button>
        </footer>
      </div>
    </div>
  )
}

export default SettingsModal
