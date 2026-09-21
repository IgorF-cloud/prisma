import { FormEvent, useState } from 'react'
import {
 ArrowLeft,
 ArrowRight,
 Check,
 Eye,
 EyeOff,
 Lock,
 Mail,
 User,
 UserPlus
} from 'lucide-react'
import { hasInvalidUsernameChars, isValidUsername, USERNAME_ERROR_MESSAGE } from '../lib/username'
import { getErrorMessage } from '../lib/errors'
import iconName from '../assets/iconName.png'
import { AuthUser } from '../lib/authUser'
import AccountStatusScreen from './AccountStatusScreen'

interface RegisterScreenProps {
  // ⚠️ Continua sem ser chamado (desde 2026-09-16), mas por outro motivo
  // agora. Era porque a conta nascia pendente de aprovação; desde
  // 2026-09-18 ela nasce ATIVA, e o que impede entrar direto é o
  // servidor não devolver token no cadastro.
  //
  // O prop fica na fronteira de propósito: o App já o passa, e o dia em
  // que o cadastro emitir token ele volta a ser usado sem mexer em quem
  // chama.
  onAuthenticated: (user: AuthUser) => void
  onNavigateLogin: () => void
}

function RegisterScreen({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onAuthenticated: _onAuthenticated,
  onNavigateLogin
}: RegisterScreenProps): React.JSX.Element {
  const [name, setName] = useState('')
  // Obrigatório desde 2026-09-10 (o banco tem UNIQUE em lower(email)).
  // Hoje serve só pra identificar a conta; a recuperação de senha que vai
  // usar de fato é o item 11.4.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Nome de quem acabou de se cadastrar com SUCESSO — enquanto estiver
  // preenchido, a tela mostra a confirmação no lugar do formulário.
  const [createdName, setCreatedName] = useState<string | null>(null)
  // Preenchido quando o servidor recusou por falta de vaga. Substitui a
  // tela inteira, como o antigo "aguardando liberação" fazia: não é erro
  // de preenchimento, e um aviso em cima do formulário convidaria a
  // tentar de novo mexendo nos campos — o que não muda nada.
  const [limitReached, setLimitReached] = useState(false)

  const nameInvalid = hasInvalidUsernameChars(name)

  function handleNameChange(value: string): void {
    setName(value)
    setError(hasInvalidUsernameChars(value) ? USERNAME_ERROR_MESSAGE : null)
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)

    if (!isValidUsername(name)) {
      setError(USERNAME_ERROR_MESSAGE)
      return
    }

    setLoading(true)

    try {
      const result = await window.api.auth.register(name, email, password)

      // Sem vaga: a conta NEM CHEGOU A SER CRIADA (2026-09-18). O
      // servidor confere o teto antes de inserir — ver `withUserSlot` no
      // prisma_server.
      if (!result.ok) {
        setLimitReached(true)
        return
      }

      // Conta criada e JÁ ATIVA. Não entra direto no app de propósito:
      // o servidor não devolve token no cadastro, e fazer isso exigiria
      // repetir aqui toda a sequência de sessão do login (lista de
      // jogos, WebSocket de salas). Um passo a mais numa ação que se faz
      // uma vez na vida é mais barato que dois caminhos de entrada pra
      // manter em sincronia.
      setCreatedName(result.user.name)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Sem vagas: a tela inteira vira a explicação, na mesma casca que um
  // login bloqueado usa. Uma tela só pros dois porque a forma é a mesma
  // — "você não entrou, e este é o motivo" —, e assim o visual não tem
  // como divergir entre eles.
  if (limitReached) {
    return <AccountStatusScreen status="limitReached" name={name} onBack={onNavigateLogin} />
  }

  // Cadastro feito. Confirmação curta, e não um "criado!" que some
  // sozinho: a pessoa precisa saber com QUAL usuário entrar, e é isso
  // que o cartão repete.
  if (createdName) {
    return (
      <div className="auth-page">
        <div className="status-card">
          <img src={iconName} alt="Prisma" className="status-card-logo" />

          <div className="status-card-icon status-card-icon-created">
            <Check size={26} />
          </div>

          <h1 className="status-card-title">Conta criada</h1>

          <span className="status-card-account">
            <User size={13} />
            {createdName}
          </span>

          <p className="status-card-lead">
            Tudo pronto — a conta já está liberada para uso.
          </p>

          <p className="status-card-body status-card-body-created">
            Entre com o usuário e a senha que você acabou de cadastrar. Se marcar
            &ldquo;manter conectado&rdquo;, o Prisma não vai pedir de novo nas próximas vezes.
          </p>

          <button
            type="button"
            className="auth-submit status-card-back"
            onClick={onNavigateLogin}
          >
            Ir para o login
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-split">
        <div>
          <div className="auth-card">
            <button
              type="button"
              className="auth-back"
              onClick={onNavigateLogin}
              aria-label="Voltar"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="auth-card-icon">
              <UserPlus size={24} />
            </div>
            <h1 className="auth-card-title">Criar conta</h1>
            <p className="auth-card-subtitle">Preencha os dados pra começar</p>

            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="auth-input-group">
                <User size={16} className="auth-input-icon" />
                <input
                  type="text"
                  className={nameInvalid ? 'input-invalid' : undefined}
                  placeholder="Usuário"
                  aria-label="Usuário"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {/* `type="email"` deixa o próprio Chromium barrar o formato
                  errado antes de sair da tela — o servidor revalida de
                  qualquer jeito (isValidEmail no server.js). */}
              <div className="auth-input-group">
                <Mail size={16} className="auth-input-icon" />
                <input
                  type="email"
                  placeholder="E-mail"
                  aria-label="E-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="auth-input-group">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Senha"
                  aria-label="Senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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

              <button type="submit" className="auth-submit" disabled={loading || nameInvalid}>
                <ArrowRight size={16} />
                {loading ? 'Aguarde...' : 'Cadastrar'}
              </button>
            </form>
          </div>

          <p className="auth-switch-line">
            Já tem conta?{' '}
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

export default RegisterScreen
