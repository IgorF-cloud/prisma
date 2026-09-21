import { ArrowRight, Ban, User, Users } from 'lucide-react'
import iconName from '../assets/iconName.png'

// O que esta tela sabe explicar.
//
// ⚠️ MUDOU em 2026-09-18. Eram três situações de CONTA (`pending`,
// `rejected`, `blocked`), porque cada cadastro passava por aprovação
// manual. A aprovação acabou: quem se cadastra entra na hora, enquanto
// houver vaga no teto de contas do servidor.
//
// Sobrou `blocked` — conta que existe e foi barrada — e entrou
// `limitReached`, que não é situação de conta nenhuma: é o servidor
// dizendo que não há mais vaga, e nesse caso a conta sequer chega a ser
// criada. Os dois moram aqui porque são a mesma tela: "você não entrou,
// e este é o motivo".
export type AccountStatus = 'blocked' | 'limitReached'

interface AccountStatusScreenProps {
  status: AccountStatus
  // Nome da conta, quando se sabe. No cadastro sempre se sabe; num login
  // recusado, é o que foi digitado.
  name?: string | null
  onBack: () => void
}

// O que dizer em cada caso. Separado do JSX porque é a única coisa que
// muda entre eles — e porque ler os textos juntos é o que garante que
// não se contradigam.
const COPY: Record<
  AccountStatus,
  { icon: typeof Ban; title: string; lead: string; body: string; back: string }
> = {
  blocked: {
    icon: Ban,
    title: 'Conta bloqueada',
    lead: 'Esta conta está bloqueada e não pode entrar.',
    body: 'Entre em contato com o administrador do Prisma para entender o motivo.',
    back: 'Voltar para o login'
  },
  limitReached: {
    icon: Users,
    title: 'Não há vagas no momento',
    lead: 'O Prisma atingiu o número máximo de contas, e a sua não chegou a ser criada.',
    body:
      'Isso não tem a ver com você nem com os dados que você preencheu — é um limite do ' +
      'servidor, que existe pra manter a qualidade das transmissões. Entre em contato com o ' +
      'administrador do Prisma para pedir a liberação de uma vaga; assim que houver espaço, ' +
      'é só se cadastrar normalmente.',
    back: 'Voltar para o login'
  }
}

// Tela de "você não entrou, e este é o motivo" (2026-09-16).
//
// Usada por DOIS caminhos, e é por isso que ela existe como componente
// próprio em vez de um aviso dentro de cada tela:
//
//   - num login recusado porque a conta está bloqueada;
//   - num cadastro recusado porque o servidor está sem vagas.
//
// Nos dois casos a tela INTEIRA é substituída, e não é mostrado um erro
// em cima do formulário. A diferença importa: um formulário que continua
// ali, preenchido e clicável, convida a tentar de novo — e tentar de
// novo não vai mudar nada até alguém do outro lado agir.
//
// ⚠️ Chegar aqui significa que NÃO houve login. Nenhum token foi
// guardado e nenhuma sessão foi salva, então o "manter conectado" não
// tem o que manter — quem garante isso é a ordem em LoginScreen.tsx (o
// `session.save` só roda depois de o login dar certo).
function AccountStatusScreen({ status, name, onBack }: AccountStatusScreenProps): React.JSX.Element {
  const copy = COPY[status]
  const Icon = copy.icon

  return (
    <div className="auth-page">
      {/* Um cartão CENTRADO, e não o layout dividido do login/cadastro
          (2026-09-17, pedido do usuário).
          ------------------------------------------------------------
          A diferença é intencional e carrega significado: naquelas
          telas há algo a fazer, e a marca ao lado do formulário é
          enfeite de boas-vindas. Aqui não há o que preencher — a tela é
          um RECADO. Um formulário-fantasma ao lado da explicação
          convidaria a tentar de novo, e tentar de novo não muda nada até
          um administrador agir.

          Por isso a marca entrou PRA DENTRO do cartão: o cartão passa a
          ser a tela inteira, e não uma metade dela. */}
      <div className="status-card">
        <img src={iconName} alt="Prisma" className="status-card-logo" />

        <div className={`status-card-icon status-card-icon-${status}`}>
          <Icon size={26} />
        </div>

        <h1 className="status-card-title">{copy.title}</h1>

        {name && (
          <span className="status-card-account">
            <User size={13} />
            {name}
          </span>
        )}

        <p className="status-card-lead">{copy.lead}</p>

        {/* O parágrafo longo fica num bloco próprio, com fundo e uma
            barra lateral na cor da situação: separa "o que aconteceu"
            (acima) de "o que fazer a respeito" (aqui), que é a única
            coisa acionável da tela. */}
        <p className={`status-card-body status-card-body-${status}`}>{copy.body}</p>

        <button type="button" className="auth-submit status-card-back" onClick={onBack}>
          {copy.back}
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}

export default AccountStatusScreen
