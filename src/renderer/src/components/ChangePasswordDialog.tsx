import { FormEvent, useEffect, useState, type JSX } from 'react'
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MailCheck,
  Send,
  ShieldCheck,
  TriangleAlert,
  X
} from 'lucide-react'
import { getErrorMessage } from '../lib/errors'
import { AuthUser } from '../lib/authUser'

interface ChangePasswordDialogProps {
  user: AuthUser
  onClose: () => void
  onUserUpdate: (user: AuthUser) => void
  onNotify: (message: string, isError?: boolean) => void
  onLogout: () => void
}

// Troca de senha pela janela de perfil (2026-10-19, pedido do usuário).
// "Funciona da mesma maneira que o Esqueci minha senha": código de 6
// dígitos no e-mail da conta, depois código + senha nova. As rotas são
// as MESMAS do ForgotPasswordScreen — a diferença está no main
// (`auth:resetOwnPassword`), que entra de novo com a senha nova pra
// esta sessão não cair junto com as outras.
//
//   'send'     -> mostra pra qual e-mail vai, e manda o código
//   'code'     -> digita o código
//   'password' -> senha nova + repetir, e o diálogo de confirmação
//   'done'     -> pronto
//
// O servidor não tem rota pra "só conferir o código": ele confere o
// código JUNTO com a senha nova. Então o passo 'code' só valida o
// formato, e se o código estiver errado o erro chega no 'password' — e
// a tela volta pro 'code' com a mensagem do servidor (quantas
// tentativas restam), em vez de mostrar erro de código na tela de senha.
type Step = 'send' | 'code' | 'password' | 'done'

const STEPS: { key: Exclude<Step, 'done'>; label: string }[] = [
  { key: 'send', label: 'E-mail' },
  { key: 'code', label: 'Código' },
  { key: 'password', label: 'Nova senha' }
]

// Bate com o servidor (db/passwordResets.js) — duplicado só pra tela.
const CODE_LENGTH = 6

// Mensagem que o main lança quando a senha MUDOU mas o login automático
// com ela falhou. Ver `auth:resetOwnPassword`.
const RELOGIN_FAILED = 'PASSWORD_CHANGED_RELOGIN_FAILED'

function ChangePasswordDialog({
  user,
  onClose,
  onUserUpdate,
  onNotify,
  onLogout
}: ChangePasswordDialogProps): JSX.Element {
  const [step, setStep] = useState<Step>('send')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const passwordsMismatch = repeatPassword.length > 0 && newPassword !== repeatPassword
  const stepIndex = STEPS.findIndex((s) => s.key === step)

  // Esc: fecha o diálogo de confirmação se estiver aberto; senão cancela
  // tudo. Durante um request não faz nada — fechar no meio deixaria a
  // pessoa sem saber se a senha mudou.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || loading) return
      event.stopPropagation()
      if (confirmOpen) setConfirmOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmOpen, loading, onClose])

  async function sendCode(): Promise<boolean> {
    setError(null)
    setLoading(true)
    try {
      await window.api.auth.requestPasswordReset(user.email)
      return true
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível enviar o código. Tente de novo.'))
      return false
    } finally {
      setLoading(false)
    }
  }

  async function handleSend(): Promise<void> {
    if (loading) return
    if (await sendCode()) setStep('code')
  }

  async function handleResend(): Promise<void> {
    if (loading) return
    if (await sendCode()) {
      // O código anterior deixou de valer — deixar os dígitos velhos ali
      // convida a gastar uma das 5 tentativas com o errado.
      setCode('')
      onNotify('Código reenviado. Confira seu e-mail.')
    }
  }

  function handleCodeContinue(event: FormEvent): void {
    event.preventDefault()
    if (code.length < CODE_LENGTH) return
    setError(null)
    setStep('password')
  }

  function handlePasswordSubmit(event: FormEvent): void {
    event.preventDefault()
    if (!newPassword || passwordsMismatch || newPassword !== repeatPassword) return
    setError(null)
    setConfirmOpen(true)
  }

  async function handleConfirmedSave(): Promise<void> {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const updated = await window.api.auth.resetOwnPassword(
        user.email,
        code,
        newPassword,
        user.name
      )
      onUserUpdate(updated)
      setConfirmOpen(false)
      setStep('done')
    } catch (err) {
      const message = getErrorMessage(err, 'Não foi possível alterar a senha.')
      setConfirmOpen(false)

      if (message === RELOGIN_FAILED) {
        // A senha mudou, mas esta sessão já foi revogada pelo servidor.
        // Não há como continuar logado — o honesto é dizer o que
        // aconteceu e mandar pro login.
        onNotify('Senha alterada. Entre de novo com a senha nova.')
        onLogout()
        return
      }

      // Código errado/expirado: o problema é do passo anterior, então é
      // pra lá que a tela volta, com a mensagem do servidor.
      if (message.startsWith('Código')) {
        setCode('')
        setStep('code')
      }
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  function goBack(): void {
    setError(null)
    if (step === 'code') setStep('send')
    else if (step === 'password') setStep('code')
  }

  return (
    // O clique no fundo NÃO cancela: aqui tem progresso (um código já
    // enviado, uma senha digitada), e perdê-lo por um clique fora seria
    // castigo. Sair é pelo "Cancelar" ou pelo X. O `stopPropagation`
    // impede o clique de chegar no fundo da janela de perfil, que fica
    // por baixo e fecha com clique.
    <div
      className="modal-backdrop password-dialog-backdrop"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="password-dialog" role="dialog" aria-modal="true" aria-label="Alterar senha">
        <header className="password-dialog-header">
          {(step === 'code' || step === 'password') && (
            <button
              type="button"
              className="password-dialog-back"
              onClick={goBack}
              disabled={loading}
              aria-label="Voltar"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <button
            type="button"
            className="password-dialog-close"
            onClick={onClose}
            disabled={loading}
            aria-label="Cancelar troca de senha"
          >
            <X size={16} />
          </button>

          <div
            className={`password-dialog-icon${step === 'done' ? ' password-dialog-icon-done' : ''}`}
          >
            {step === 'send' && <Mail size={24} />}
            {step === 'code' && <MailCheck size={24} />}
            {step === 'password' && <KeyRound size={24} />}
            {step === 'done' && <ShieldCheck size={26} />}
          </div>

          <h2 className="password-dialog-title">
            {step === 'send' && 'Alterar senha'}
            {step === 'code' && 'Digite o código'}
            {step === 'password' && 'Crie a nova senha'}
            {step === 'done' && 'Senha alterada!'}
          </h2>

          {step !== 'done' && (
            <ol className="password-steps" aria-label="Etapas">
              {STEPS.map((s, index) => (
                <li
                  key={s.key}
                  className={`password-step${index < stepIndex ? ' password-step-done' : ''}${
                    index === stepIndex ? ' password-step-current' : ''
                  }`}
                >
                  <span className="password-step-dot">
                    {index < stepIndex ? <Check size={11} strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="password-step-label">{s.label}</span>
                </li>
              ))}
            </ol>
          )}
        </header>

        <div className="password-dialog-body">
          {step === 'send' && (
            <>
              <p className="password-dialog-text">
                Para sua segurança, vamos enviar um código de {CODE_LENGTH} dígitos para o e-mail da
                sua conta:
              </p>
              <div className="password-dialog-email">
                <Mail size={15} />
                <span title={user.email}>{user.email}</span>
              </div>

              {error && <p className="auth-error">{error}</p>}

              <button
                type="button"
                className="auth-submit password-dialog-submit"
                onClick={handleSend}
                disabled={loading}
                autoFocus
              >
                {loading ? 'Enviando...' : 'Enviar código'}
                {!loading && <Send size={16} />}
              </button>
            </>
          )}

          {step === 'code' && (
            <form className="auth-form" onSubmit={handleCodeContinue}>
              <p className="password-dialog-text">
                Enviamos o código para <strong>{user.email}</strong>. Ele vale por 15 minutos.
              </p>

              <div className="auth-input-group">
                <ShieldCheck size={16} className="auth-input-icon" />
                <input
                  type="text"
                  className="auth-code-input"
                  placeholder="000000"
                  aria-label="Código de verificação"
                  value={code}
                  // `text` e não `number`: o código pode começar com zero.
                  inputMode="numeric"
                  maxLength={CODE_LENGTH}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                  required
                />
              </div>

              {error && <p className="auth-error">{error}</p>}

              <button
                type="submit"
                className="auth-submit password-dialog-submit"
                disabled={loading || code.length < CODE_LENGTH}
              >
                Continuar
              </button>

              <button
                type="button"
                className="auth-switch auth-resend password-dialog-resend"
                onClick={handleResend}
                disabled={loading}
              >
                {loading ? 'Reenviando...' : 'Não recebeu? Enviar de novo'}
              </button>
            </form>
          )}

          {step === 'password' && (
            <form className="auth-form" onSubmit={handlePasswordSubmit}>
              <div className="auth-input-group">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Nova senha"
                  aria-label="Nova senha"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Repetir a senha só existe AQUI, e não no "Esqueci minha
                  senha": lá a pessoa já está fora da conta de qualquer
                  jeito, aqui um erro de digitação trancaria pra fora
                  alguém que estava logado. */}
              <div className="auth-input-group">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={passwordsMismatch ? 'input-invalid' : undefined}
                  placeholder="Repita a nova senha"
                  aria-label="Repita a nova senha"
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                  required
                />
              </div>

              {passwordsMismatch && <p className="auth-error">As senhas não são iguais.</p>}
              {error && <p className="auth-error">{error}</p>}

              <button
                type="submit"
                className="auth-submit password-dialog-submit"
                disabled={loading || !newPassword || newPassword !== repeatPassword}
              >
                Salvar nova senha
              </button>
            </form>
          )}

          {step === 'done' && (
            <>
              <p className="password-dialog-text password-dialog-text-center">
                Sua senha foi trocada. Você continua conectado neste computador.
              </p>
              <div className="auth-sent-badge">
                <ShieldCheck size={15} />
                <span>As sessões em outros dispositivos foram encerradas</span>
              </div>
              <button
                type="button"
                className="auth-submit password-dialog-submit"
                onClick={onClose}
                autoFocus
              >
                Concluir
              </button>
            </>
          )}
        </div>

        {step !== 'done' && (
          <footer className="password-dialog-footer">
            <button
              type="button"
              className="password-dialog-cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
          </footer>
        )}
      </div>

      {confirmOpen && (
        <div className="modal-backdrop confirm-dialog-backdrop">
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-password-title"
          >
            <div className="confirm-dialog-icon">
              <TriangleAlert size={22} />
            </div>
            <h3 id="confirm-password-title" className="confirm-dialog-title">
              Confirmar a nova senha?
            </h3>
            <p className="confirm-dialog-text">
              Sua senha será trocada agora. As sessões abertas em{' '}
              <strong>outros dispositivos</strong> serão encerradas e precisarão entrar com a senha
              nova.
            </p>
            <p className="confirm-dialog-text confirm-dialog-text-muted">
              Este computador continua conectado.
            </p>
            {error && <p className="auth-error">{error}</p>}
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="pill-button"
                onClick={() => setConfirmOpen(false)}
                disabled={loading}
              >
                Voltar
              </button>
              <button
                type="button"
                className="pill-button pill-button-accent"
                onClick={handleConfirmedSave}
                disabled={loading}
                autoFocus
              >
                {loading ? 'Salvando...' : 'Sim, alterar senha'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangePasswordDialog
