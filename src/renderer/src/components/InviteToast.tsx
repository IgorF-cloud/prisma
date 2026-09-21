import { useEffect } from 'react'
import { Lock } from 'lucide-react'

interface InviteToastProps {
  hostName: string | null
  onAccept: () => void
  // O MOTIVO da recusa (2026-09-14): o botão e o fim do tempo são
  // coisas diferentes pra quem convidou — "recusou" e "não
  // respondeu" dizem coisas diferentes sobre a pessoa.
  onDecline: (reason: 'declined' | 'expired') => void
}

// Quanto tempo o convite fica na tela antes de ser recusado sozinho.
// Precisa bater com a duração da animação `invite-timeout` no CSS — a
// barra é puramente visual, quem de fato recusa é o timer daqui.
// 30s desde 2026-09-13 (era 10, pedido do usuário). Dez segundos mal
// davam pra quem estava com o app minimizado voltar pra janela — e
// agora que a barra de tarefas pisca avisando, a pessoa precisa de
// tempo pra reagir ao aviso, não só pra ler o toast.
//
// ⚠️ Tem que bater com a duração da animação `invite-timeout` no CSS:
// a barrinha é puro CSS (ver o comentário abaixo), então os dois
// números são a MESMA contagem em dois lugares. Divergirem significa
// a barra zerar antes ou depois do convite morrer de verdade.
const INVITE_TIMEOUT_MS = 30000

// Convite pra uma live privada (item 8/11 do ROADMAP, 2026-09-10).
//
// Canto superior DIREITO, por pedido do usuário — e de propósito longe do
// `Snackbar` genérico, que vive embaixo: os dois podem aparecer ao mesmo
// tempo (ex: "convite enviado" pro host e um convite chegando pra ele),
// e no mesmo canto um cobriria o outro.
//
// Aceitar faz DUAS coisas de uma vez: entra na lista de permissão da sala
// no servidor (é o que faz ela aparecer na lista dele) e já conecta na
// live. Não existe "aceitar e ver depois".
//
// Recusar — no botão ou pelo tempo acabar — não muda permissão nenhuma:
// o convite nunca chegou a criar estado, só a ACEITAÇÃO cria. Recusado,
// a sala continua invisível pra essa pessoa, que é o estado de antes.
//
// Mas desde 2026-09-14 a recusa AVISA o servidor mesmo assim, por um
// motivo que não é de permissão e sim de informação: é o que destrava o
// botão de convidar do lado do host e conta pra ele o que aconteceu.
// Ver useInviteTracking.ts.
function InviteToast({ hostName, onAccept, onDecline }: InviteToastProps): React.JSX.Element {
  // Recusa automática. `onDecline` nas dependências faria o timer
  // reiniciar a cada render do pai (a função é recriada toda vez) e o
  // convite nunca expiraria — por isso a lista vazia e o disable do lint.
  useEffect(() => {
    const timer = setTimeout(() => onDecline('expired'), INVITE_TIMEOUT_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="invite-toast" role="alertdialog" aria-label="Convite para transmissão privada">
      <div className="invite-toast-head">
        <span className="invite-toast-icon">
          <Lock size={14} />
        </span>
        <span className="invite-toast-text">
          <strong>{hostName ?? 'Alguém'}</strong> está te convidando para a transmissão
        </span>
      </div>

      <div className="invite-toast-actions">
        <button
          type="button"
          className="invite-toast-decline"
          onClick={() => onDecline('declined')}
        >
          Recusar
        </button>
        <button type="button" className="invite-toast-accept" onClick={onAccept}>
          Aceitar
        </button>
      </div>

      {/* Só a animação do CSS encolhe isto — nada de state por quadro. Um
          contador em React re-renderizaria o componente ~600 vezes em 10s
          pra desenhar o que uma transição resolve na GPU. */}
      <span className="invite-toast-timeout" aria-hidden="true" />
    </div>
  )
}

export default InviteToast
