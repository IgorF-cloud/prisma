import { FormEvent, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, Send, ShieldCheck } from 'lucide-react'
import iconName from '../assets/iconName.png'
import { getErrorMessage } from '../lib/errors'

interface ForgotPasswordScreenProps {
  onNavigateLogin: () => void
  onNotify: (message: string) => void
}

// Tela de recuperação de senha (2026-09-10, item 16.4 do ROADMAP).
//
// Nasceu como casca em 2026-09-10 de manhã ("apenas a tela com um campo
// solicitando o e-mail") e ganhou o fluxo de verdade à tarde, quando o
// back-end chegou. São dois passos numa tela só:
//
//   'email'  -> POST /password-reset/request   (manda o código)
//   'code'   -> POST /password-reset/confirm   (código + senha nova)
//
// Código de 6 dígitos, e não link mágico: o app é DESKTOP, e um link
// teria que abrir o navegador e voltar pra cá por protocolo customizado
// registrado no instalador. Muito mais peça pra quebrar, pro mesmo
// resultado.
type Step = 'email' | 'code' | 'done'

// Bate com o servidor (db/passwordResets.js). Duplicado aqui só pra
// mensagem da tela — a validação que vale é a de lá.
const CODE_LENGTH = 6

function ForgotPasswordScreen({
  onNavigateLogin,
  onNotify
}: ForgotPasswordScreenProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleRequest(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)

    try {
      await window.api.auth.requestPasswordReset(email.trim())
      // Avança MESMO se o e-mail não existir — o servidor responde igual
      // nos dois casos de propósito, pra não virar um oráculo de "quem
      // tem conta aqui". Quem digitou errado descobre no passo seguinte,
      // quando nenhum código chegar.
      setStep('code')
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível enviar o código. Tente de novo.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)

    try {
      await window.api.auth.confirmPasswordReset(email.trim(), code.trim(), newPassword)
      setStep('done')
    } catch (err) {
      // A mensagem vem do servidor e é específica de propósito aqui
      // (quantas tentativas restam, ou "peça um novo código") — quem
      // chegou com um código na mão já provou ter acesso à caixa de
      // e-mail, então detalhar não entrega nada a estranhos.
      setError(getErrorMessage(err, 'Não foi possível redefinir a senha.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleResend(): Promise<void> {
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      await window.api.auth.requestPasswordReset(email.trim())
      onNotify('Código reenviado. Confira seu e-mail.')
      // Limpa o campo: o código anterior deixou de valer, e deixar os
      // dígitos velhos ali convida a tentar de novo com o errado —
      // gastando uma das 5 tentativas.
      setCode('')
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível reenviar o código.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-split">
        <div>
          <div className="auth-card">
            <button
              type="button"
              className="auth-back"
              onClick={step === 'code' ? () => setStep('email') : onNavigateLogin}
              aria-label="Voltar"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="auth-card-icon">
              {step === 'done' ? <ShieldCheck size={24} /> : <KeyRound size={24} />}
            </div>

            {step === 'email' && (
              <>
                <h1 className="auth-card-title">Recuperar senha</h1>
                <p className="auth-card-subtitle">
                  Informe o e-mail da sua conta e enviaremos um código para criar uma nova senha
                </p>

                <form className="auth-form" onSubmit={handleRequest}>
                  <div className="auth-input-group">
                    <Mail size={16} className="auth-input-icon" />
                    <input
                      type="email"
                      placeholder="E-mail"
                      aria-label="E-mail"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>

                  {error && <p className="auth-error">{error}</p>}

                  <button type="submit" className="auth-submit" disabled={loading}>
                    {loading ? 'Enviando...' : 'Enviar código'}
                    <Send size={16} />
                  </button>
                </form>
              </>
            )}

            {step === 'code' && (
              <>
                <h1 className="auth-card-title">Digite o código</h1>
                {/* Continua vago ("se existir uma conta") mesmo depois de
                    o e-mail ter sido aceito: é aqui que a ausência de
                    confirmação importa, porque esta tela aparece
                    exatamente igual pra um e-mail que não existe. */}
                <p className="auth-card-subtitle">
                  Se existir uma conta com <strong>{email}</strong>, enviamos um código de{' '}
                  {CODE_LENGTH} dígitos. Ele vale por 15 minutos.
                </p>

                <form className="auth-form" onSubmit={handleConfirm}>
                  <div className="auth-input-group">
                    <ShieldCheck size={16} className="auth-input-icon" />
                    <input
                      type="text"
                      className="auth-code-input"
                      placeholder="000000"
                      aria-label="Código de verificação"
                      value={code}
                      // `inputMode` numérico levanta o teclado certo, mas
                      // o type continua `text`: com `number` o campo
                      // comeria zeros à esquerda, e o código pode começar
                      // com zero.
                      inputMode="numeric"
                      maxLength={CODE_LENGTH}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      autoFocus
                      required
                    />
                  </div>

                  <div className="auth-input-group">
                    <Lock size={16} className="auth-input-icon" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Nova senha"
                      aria-label="Nova senha"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
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

                  {error && <p className="auth-error">{error}</p>}

                  <button
                    type="submit"
                    className="auth-submit"
                    disabled={loading || code.length < CODE_LENGTH}
                  >
                    {loading ? 'Aguarde...' : 'Redefinir senha'}
                  </button>
                </form>

                <button
                  type="button"
                  className="auth-switch auth-resend"
                  onClick={handleResend}
                  disabled={loading}
                >
                  Não recebeu? Enviar de novo
                </button>
              </>
            )}

            {step === 'done' && (
              <>
                <h1 className="auth-card-title">Senha redefinida</h1>
                <p className="auth-card-subtitle">Pronto. Entre com a senha nova.</p>

                {/* Aviso e não erro: é consequência esperada, e explicar
                    evita a pessoa achar que deu problema quando o app na
                    outra máquina pedir login. */}
                <div className="auth-sent-badge">
                  <ShieldCheck size={15} />
                  <span>Todas as sessões foram encerradas</span>
                </div>

                <button type="button" className="auth-submit" onClick={onNavigateLogin}>
                  Ir para o login
                </button>
              </>
            )}
          </div>

          {/* Fora do `.auth-card`, igual no login e no cadastro — é o
              padrão das duas telas irmãs. */}
          <p className="auth-switch-line">
            Lembrou a senha?{' '}
            <button type="button" className="auth-switch" onClick={onNavigateLogin}>
              Entrar
            </button>
          </p>
        </div>

        <div className="auth-branding">
          <img src={iconName} alt="Prisma" />
        </div>
      </div>
    </div>
  )
}

export default ForgotPasswordScreen
