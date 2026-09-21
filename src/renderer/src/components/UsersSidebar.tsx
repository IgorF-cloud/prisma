import { useCallback, useMemo, useState } from 'react'
import { ChevronLeft, Send } from 'lucide-react'
import { AvatarRef } from '../lib/avatar'
import { PresenceMap } from '../lib/useRooms'
import { getErrorMessage } from '../lib/errors'
import UserAvatar from './UserAvatar'
import Tooltip from './Tooltip'
import UserCardPopover, { UserCardTarget } from './UserCardPopover'

interface DirectoryUser {
  id: number
  name: string
  avatar: AvatarRef | null
}

interface UsersSidebarProps {
  apiBaseUrl: string
  // A lista vem PRONTA de fora (useUsersDirectory, na HomeScreen).
  //
  // Antes era buscada aqui dentro, num useEffect — e como este
  // componente só existe enquanto o painel está aberto, cada clique
  // no botão montava tudo de novo e disparava um GET /users. O
  // usuário sentia isso como um atraso ao abrir (2026-09-11): o
  // botão não estava exibindo a lista, estava reconstruindo ela.
  users: DirectoryUser[]
  loading: boolean
  loadError: string | null
  // Diretório nome -> foto EM TEMPO REAL, do broadcast de salas (ver
  // useRooms).
  //
  // Existe porque a lista acima é um retrato: ela é buscada uma vez e
  // vive daquilo. Quando alguém troca a própria foto, o `avatar` de lá
  // continua com a VERSÃO antiga — e como a URL da foto carrega essa
  // versão como cache-buster (/avatars/<id>.webp?v=N), o navegador
  // segue servindo a imagem antiga do cache. Era o defeito relatado
  // pelo usuário em 2026-09-17: a foto nova aparecia em todo lugar,
  // menos na lista de usuários dos outros.
  //
  // Este mapa chega pelo WebSocket a cada troca, então ele tem sempre a
  // versão certa. A lista buscada continua sendo a fonte de QUEM
  // existe; este mapa é a fonte de COMO cada um está agora.
  liveAvatars: Record<string, AvatarRef>
  // Quem está conectado agora. Vem junto do broadcast de salas (ver
  // useRooms) — quem não está no mapa está offline.
  presence: PresenceMap
  // Meu id, pra me tirar da lista: convidar a si mesmo não faz sentido.
  currentUserId: number
  // Código da MINHA live no ar, ou null. É o que decide se o botão de
  // convidar aparece — sem live não há pra onde convidar. Vale pra sala
  // pública também: lá o convite é um atalho, aqui é o único caminho.
  myRoomCode: string | null
  // A live já existe no SERVIDOR (2026-09-13)? Entre iniciar a
  // transmissão e o servidor registrar a sala passam alguns segundos
  // — ver a explicação completa na HomeScreen. Enquanto isso o botão
  // aparece DESABILITADO em vez de mandar um convite que vai falhar
  // com "Sala não encontrada".
  //
  // Desabilitado e não escondido: sumir e reaparecer sozinho pareceria
  // defeito, e não explicaria a espera.
  liveReadyForInvites: boolean
  // Convites NO AR desta live, por id (2026-09-14). Vem de fora — do
  // useInviteTracking na HomeScreen — porque o resultado de um convite
  // pode chegar com este painel FECHADO, e ele é destruído ao fechar.
  // Guardado aqui dentro, o "recusou" se perderia e o botão
  // reapareceria travado.
  pendingInvites: Set<number>
  onInvited: (userId: number) => void
  // Quem está assistindo a MINHA live agora, por nome. É daqui que sai
  // o "já está na sua live" — derivado da lista em tempo real, e não
  // de um "aceitou" guardado: assim, se a pessoa sair da sala, dá pra
  // convidar de novo sem precisar apagar estado nenhum.
  myViewers: string[]
  onClose: () => void
  onNotify: (message: string, isError?: boolean) => void
}

const STATUS_LABEL = { online: 'Online', busy: 'Ocupado', offline: 'Offline' } as const

// Ordem de exibição da lista (2026-09-13, pedido do usuário): quem está
// disponível no topo, ocupado no meio, offline no fim.
//
// Um mapa de PESO, e não uma cadeia de `if`, porque a ordem passa a ser
// um dado — mexer nela é reordenar estes números, e um estado novo entra
// aqui sem tocar no `sort`.
const STATUS_ORDER = { online: 0, busy: 1, offline: 2 } as const

// Item 11 do ROADMAP — a sub-barra de USUÁRIOS do app.
//
// Duas fontes, de propósito: a LISTA vem do banco (GET /users, todo mundo
// que tem conta, inclusive offline) e o ESTADO vem do WebSocket de salas,
// em tempo real. Se as duas viessem do mesmo lugar, ou a lista precisaria
// ser reconsultada a cada pessoa que conecta, ou o status ficaria parado
// até alguém dar refresh.
//
// Divide a casca (`.side-panel*`) com o RoomDetailsSidebar: os dois ocupam
// o mesmo lugar e nunca aparecem juntos, porque a HomeScreen guarda os
// dois num estado só (ver `sidePanel` lá).
function UsersSidebar({
  apiBaseUrl,
  users,
  loading,
  loadError,
  liveAvatars,
  presence,
  currentUserId,
  myRoomCode,
  liveReadyForInvites,
  pendingInvites,
  onInvited,
  myViewers,
  onClose,
  onNotify
}: UsersSidebarProps): React.JSX.Element {
  // Ficha do usuário clicado (2026-09-13). `null` = nenhuma aberta.
  const [card, setCard] = useState<UserCardTarget | null>(null)
  // Estável: o hook de fechar o card registra listeners no
  // documento com esta função como dependência — sem o useCallback
  // eles seriam removidos e re-registrados a cada render.
  const closeCard = useCallback(() => setCard(null), [])

  // A foto EM TEMPO REAL quando existir; a do retrato como reserva.
  //
  // A ordem é o que conserta o defeito: a lista buscada tem a versão do
  // momento em que foi carregada, e o mapa do WebSocket tem a de agora.
  // Quem chegou por último ganha.
  //
  // A reserva não é decoração — o mapa vem indexado por NOME, e uma
  // renomeação entre a carga da lista e o broadcast deixaria a chave sem
  // par por um instante. Nesse intervalo, a foto antiga é melhor que
  // nenhuma.
  const avatarOf = useCallback(
    (user: DirectoryUser): AvatarRef | null => liveAvatars[user.name] ?? user.avatar,
    [liveAvatars]
  )

  function handleTileClick(
    event: React.MouseEvent<HTMLButtonElement>,
    user: DirectoryUser,
    status: keyof typeof STATUS_LABEL
  ): void {
    // O clique morre aqui de propósito. Quem fecha a ficha é um
    // listener de clique no documento; se o evento chegasse lá, o
    // segundo clique no mesmo tile fecharia e reabriria no mesmo
    // instante — e a ficha nunca fecharia pelo tile.
    event.stopPropagation()
    // Medido ANTES do setState: `currentTarget` só vale durante o
    // despacho do evento, e dentro da função de atualização já é
    // null.
    // Ancora no <li>, não no botão: o botão começa depois do padding
    // do item, e o card saía visivelmente mais baixo que o tile
    // realçado. O <li> é o retângulo que a pessoa enxerga — é ele que
    // pinta o fundo do hover.
    const tile = event.currentTarget.closest('li') ?? event.currentTarget
    const rect = tile.getBoundingClientRect()
    setCard((current) =>
      current?.name === user.name
        ? null
        : { name: user.name, avatar: avatarOf(user), status, rect }
    )
  }

  async function handleInvite(user: DirectoryUser): Promise<void> {
    if (!myRoomCode || !liveReadyForInvites) return
    try {
      await window.api.users.invite(myRoomCode, user.id)
      onInvited(user.id)
      onNotify(`Convite enviado para ${user.name}`)
    } catch (err) {
      onNotify(getErrorMessage(err, 'Não foi possível enviar o convite'), true)
    }
  }

  // Ordenada por status, e reativa: `presence` vem do WebSocket de
  // salas, então alguém ficando online/ocupado re-renderiza e a lista
  // se reordena sozinha, sem nenhum refresh.
  //
  // `filter` antes do `sort` não é só estilo: `sort` ordena NO LUGAR, e
  // aplicá-lo direto em `users` mutaria o array que veio por prop — o
  // estado do hook lá na HomeScreen. O `filter` já devolve uma cópia,
  // então o `sort` aqui mexe só nela.
  const others = useMemo(() => {
    return users
      .filter((u) => u.id !== currentUserId)
      .sort((a, b) => {
        const peso =
          STATUS_ORDER[presence[a.id] ?? 'offline'] - STATUS_ORDER[presence[b.id] ?? 'offline']
        if (peso !== 0) return peso
        // Empate de status: mantém a ordem alfabética que o servidor já
        // devolve (ORDER BY lower(username)). Sem este desempate a
        // ordem dentro de cada grupo ficaria à mercê da implementação do
        // `sort`, e a lista poderia embaralhar a cada mudança de
        // presença de outra pessoa.
        return a.name.localeCompare(b.name, 'pt-BR')
      })
  }, [users, presence, currentUserId])

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <div className="side-panel-heading">
          <span className="side-panel-title">Usuários</span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar lista de usuários"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      {loading ? (
        <p className="room-details-empty">Carregando...</p>
      ) : loadError ? (
        <p className="auth-error">{loadError}</p>
      ) : others.length === 0 ? (
        <p className="room-details-empty">Nenhum outro usuário cadastrado.</p>
      ) : (
        <ul
          className="users-list"
          // A barra de rolagem só aparece com o cursor sobre a lista.
          // Classe posta no DOM direto, e não estado do React: evita
          // re-renderizar a lista inteira a cada entrada e saída do
          // mouse — e um `:hover` puro em CSS não serve aqui, porque o
          // Chromium não repinta os pseudo-elementos da scrollbar quando
          // só o hover do elemento que rola muda (ver main.css).
          onMouseEnter={(e) => e.currentTarget.classList.add('scroll-visible')}
          onMouseLeave={(e) => e.currentTarget.classList.remove('scroll-visible')}
        >
          {others.map((user) => {
            // Quem está offline não aparece no mapa de presença — é o
            // que este fallback cobre.
            const status = presence[user.id] ?? 'offline'
            // Convite só pra quem está logado (decisão do usuário): quem
            // está offline não tem como receber, porque a entrega é pelo
            // WebSocket dele.
            const canInvite = Boolean(myRoomCode) && status !== 'offline'
            // Convite no ar: o botão CONTINUA clicável (2026-09-14,
            // pedido do usuário) — isto aqui só muda o texto da dica.
            // Quem garante que ninguém seja incomodado duas vezes é o
            // servidor, que ignora o clique quando já existe um convite
            // de pé. Ver a rota de convite no server.js.
            const waitingAnswer = pendingInvites.has(user.id)
            // Esta sim ainda desabilita: não há o que convidar alguém
            // que já está assistindo.
            const alreadyWatching = myViewers.includes(user.name)
            return (
              <li
                key={user.id}
                className={`users-list-item${
                  card?.name === user.name ? ' user-tile-active' : ''
                }`}
              >
                {/* Avatar + nome viraram um botão (2026-09-13): clicar
                    abre a ficha do usuário. O botão de convidar fica
                    FORA dele — convidar não pode abrir ficha. */}
                <button
                  type="button"
                  className="user-tile-button"
                  onClick={(event) => handleTileClick(event, user, status)}
                  aria-label={`Ver perfil de ${user.name}`}
                >
                  <span className="mini-avatar">
                    <UserAvatar avatar={avatarOf(user)} apiBaseUrl={apiBaseUrl} size={14} />
                    <span className={`user-status-dot user-status-${status}`} />
                  </span>

                  <span className="users-list-text">
                    <span className="users-list-name">{user.name}</span>
                    <span className="users-list-status">{STATUS_LABEL[status]}</span>
                  </span>
                </button>

                {canInvite && (
                  <Tooltip
                    label={
                      !liveReadyForInvites
                        ? 'Aguarde a transmissão entrar no ar'
                        : alreadyWatching
                          ? 'Já está na sua live'
                          : waitingAnswer
                            ? 'Convite já enviado — aguardando resposta'
                            : 'Convidar para a live'
                    }
                    // Pra DIREITA (2026-09-14, pedido do usuário): este
                    // painel encosta na barra da esquerda, e um balão
                    // pra esquerda era espremido contra a borda da
                    // janela. Pra direita ele abre sobre a área das
                    // lives, onde há espaço de sobra.
                    placement="right"
                  >
                    <button
                      type="button"
                      className={`users-list-invite${
                        liveReadyForInvites ? '' : ' users-list-invite-waiting'
                      }`}
                      onClick={() => handleInvite(user)}
                      // Convite pendente NÃO trava mais o botão
                      // (2026-09-14): clicar de novo é inofensivo, o
                      // servidor ignora. O que trava é só a live ainda
                      // não existir no servidor e a pessoa já estar
                      // assistindo.
                      disabled={alreadyWatching || !liveReadyForInvites}
                      aria-label={`Convidar ${user.name}`}
                    >
                      <Send size={13} />
                    </button>
                  </Tooltip>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {card && (
        <UserCardPopover target={card} apiBaseUrl={apiBaseUrl} onClose={closeCard} />
      )}
    </aside>
  )
}

export default UsersSidebar
