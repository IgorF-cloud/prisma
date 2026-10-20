import { FormEvent, useEffect, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Lock, LogIn, User } from 'lucide-react'
import { hasInvalidUsernameChars, USERNAME_ERROR_MESSAGE } from '../lib/username'
import { getErrorMessage } from '../lib/errors'
import iconName from '../assets/iconName.png'
import { AuthUser } from '../lib/authUser'
import { formatAppVersion, VERSION_LABEL } from '../lib/appVersion'
import AccountStatusScreen, { AccountStatus } from './AccountStatusScreen'

interface LoginScreenProps {
  onAuthenticated: (user: AuthUser) => void
  // Carrega a lista de salas no estado do App (2026-10-19) — ver
  // `load` em useRooms.ts.
  onLoadRooms: () => Promise<void>
  onNavigateRegister: () => void
  onNavigateForgotPassword: () => void
}

function LoginScreen({
  onAuthenticated,
  onLoadRooms,
  onNavigateRegister,
  onNavigateForgotPassword
}: LoginScreenProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Login recusado pela SITUAÇÃO da conta (2026-09-16). Enquanto
  // estiver preenchido, a tela mostra a explicação no lugar do
  // formulário — ver AccountStatusScreen.
  const [blockedBy, setBlockedBy] = useState<AccountStatus | null>(null)
  // Pedido do usuário (2026-09-01): mesma label da HomeScreen (.app-version,
  // "v1.2.3"), mas já na tela de login — não dá pra reaproveitar
  // useAppUpdate.ts pra isso (só roda depois do login, ver `enabled` lá) —
  // usa o canal `app:getVersion` (sem rede, só `app.getVersion()`).
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.api.app.getVersion().then(setAppVersion)
  }, [])

  const nameInvalid = hasInvalidUsernameChars(name)

  function handleNameChange(value: string): void {
    setName(value)
    setError(hasInvalidUsernameChars(value) ? USERNAME_ERROR_MESSAGE : null)
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (nameInvalid) {
      setError(USERNAME_ERROR_MESSAGE)
      return
    }

    setError(null)
    setLoading(true)

    try {
      const result = await window.api.auth.login(name, password)

      // Conta não ativa: NÃO houve login. Sai antes de qualquer coisa
      // que dependa de sessão — inclusive do `session.save` do "manter
      // conectado" logo abaixo, que guardaria uma sessão que não
      // existe.
      if (!result.ok) {
        setBlockedBy(result.status)
        return
      }

      const { user } = result
      if (rememberMe) await window.api.session.save(user)

      // Lista de jogos detectáveis (item 29): baixada AQUI, ainda com o
      // botão em loading, e não ao montar o app.
      //
      // Dois motivos. O endpoint é autenticado, e antes do login não há
      // JWT nenhum — rodando no mount ele tomaria 401 desde que a auth
      // virou por usuário (2026-09-10). E, aproveitando o loading que já
      // existe, a Home abre com a lista pronta em vez de mostrar um
      // overlay de download por cima dela.
      //
      // `catch` que engole de propósito: o main só baixa se o cache
      // local venceu, e falhar aqui significa no máximo um jogo não
      // reconhecido pelo nome — não é motivo pra impedir o login.
      await window.api.games.ensureDetectableList().catch(() => {})

      // WebSocket de salas (2026-09-13). Aberto AQUI, ainda dentro do
      // loading do botão, e não no boot do app.
      //
      // Antes ele subia junto com o processo main, quando ainda não
      // havia token: tomava 4401 e ficava num ciclo de retry de 3s
      // durante toda a tela de login. E, depois do login, nada
      // reconectava — a lista de salas só aparecia quando um retry
      // daquele ciclo calhava de cair depois do token existir, o que era
      // o atraso de ~1s pras salas surgirem na Home.
      //
      // Esperar aqui é o que faz a Home JÁ NASCER com as salas. Nunca
      // rejeita (ver CONNECT_WAIT_TIMEOUT_MS no main): servidor fora do
      // ar não deve impedir alguém de entrar no app.
      await window.api.rooms.connect()

      // Lista de salas de AGORA, buscada por HTTP antes de liberar a
      // Home (2026-10-19, pedido do usuário). A conexão acima resolve
      // quando o WebSocket abre, não quando o primeiro retrato chega —
      // a Home podia nascer com a lista vazia, e as lives que já estavam
      // no ar chegavam depois parecendo novas (tocando o som de live
      // nova no login). O login demora um pouco mais; em troca a Home
      // já abre com as salas e com o alerta de live nova valendo.
      await onLoadRooms()

      onAuthenticated(user)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (blockedBy) {
    return (
      <AccountStatusScreen
        status={blockedBy}
        name={name}
        onBack={() => {
          setBlockedBy(null)
          setPassword('')
        }}
      />
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-split">
        <div className="auth-branding">
          <img src={iconName} alt="Prisma" />
        </div>

        <div>
          <div className="auth-card">
            <div className="auth-card-icon">
              <LogIn size={24} />
            </div>
            <h1 className="auth-card-title">Entrar</h1>
            <p className="auth-card-subtitle">Acesse sua conta pra continuar</p>

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

              {/* Ainda sem back-end (item 11.4): a tela existe e o fluxo
                  visual funciona, mas nada e enviado. Ver
                  ForgotPasswordScreen.tsx. */}
              <button
                type="button"
                className="auth-forgot"
                onClick={onNavigateForgotPassword}
              >
                Esqueci minha senha
              </button>

              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Manter conectado
              </label>

              {error && <p className="auth-error">{error}</p>}

              <button type="submit" className="auth-submit" disabled={loading || nameInvalid}>
                <ArrowRight size={16} />
                {loading ? 'Aguarde...' : 'Entrar'}
              </button>

              {/* O canal e o NÚMERO, lado a lado (2026-09-17). Esta é a
                  tela onde alguém pode estar travado sem conseguir
                  entrar — e "qual versão você está usando?" é a primeira
                  pergunta de qualquer suporte. */}
              {(VERSION_LABEL || appVersion) && (
                <span className="app-version auth-version">
                  {VERSION_LABEL && <span className="version-channel">{VERSION_LABEL}</span>}
                  {appVersion && formatAppVersion(appVersion)}
                </span>
              )}
            </form>
          </div>

          <p className="auth-switch-line">
            Não tem conta?{' '}
            <button type="button" className="auth-switch" onClick={onNavigateRegister}>
              Cadastrar
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

export default LoginScreen
