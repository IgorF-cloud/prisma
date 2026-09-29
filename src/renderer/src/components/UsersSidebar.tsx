import { Fragment, useCallback, useMemo, useState } from 'react'
import { ChevronLeft, Pin, PinOff, Send } from 'lucide-react'
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
  // Quem EU fixei (2026-09-25). Vem de fora pelo mesmo motivo da lista:
  // este painel é destruído ao fechar, e guardar os fixados aqui dentro
  // faria cada abertura buscá-los de novo — e o estado otimista de um
  // clique se perderia se o painel fosse fechado logo em seguida.
  pinned: ReadonlySet<number>
  // Fixar (`next = true`) ou desfixar. LANÇA se o servidor recusar; a
  // tela já terá voltado sozinha ao estado anterior (ver `setPinned` no
  // useUsersDirectory), então aqui só resta avisar.
  onTogglePin: (id: number, next: boolean) => Promise<void>
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

type UserStatus = 'online' | 'busy' | 'offline'

const STATUS_LABEL = { online: 'Online', busy: 'Ocupado', offline: 'Offline' } as const

// Ordem de exibição DENTRO de um grupo (2026-09-13, pedido do usuário):
// quem está disponível antes de quem está ocupado.
//
// Um mapa de PESO, e não uma cadeia de `if`, porque a ordem passa a ser
// um dado — mexer nela é reordenar estes números, e um estado novo entra
// aqui sem tocar no `sort`.
//
// `offline` continua no mapa mesmo depois de a lista virar dois grupos
// (2026-09-25): lá ele é o único valor possível e nunca desempata nada,
// mas tirá-lo faria o mapa deixar de cobrir todos os status — e o
// `sort` precisaria de um caso especial pra provar ao TypeScript uma
// coisa que já é verdade.
const STATUS_ORDER = { online: 0, busy: 1, offline: 2 } as const

// Um usuário da lista com o que a ordenação e o tile precisam saber, já
// resolvido. Calculado UMA vez, na montagem dos grupos: o status é usado
// três vezes por tile (ordenar, pintar o dot, decidir o convite) e é
// sempre o mesmo valor.
interface Entry {
  user: DirectoryUser
  status: UserStatus
  isPinned: boolean
}

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
  pinned,
  onTogglePin,
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
    status: UserStatus
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
      current?.name === user.name ? null : { name: user.name, avatar: avatarOf(user), status, rect }
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

  // Fixar/desfixar (2026-09-25). Sem aviso de sucesso: o resultado já
  // está na tela — o tile sobe pro topo e ganha o alfinete. Um snackbar
  // repetindo o que a pessoa acabou de ver seria só ruído.
  async function handleTogglePin(user: DirectoryUser, next: boolean): Promise<void> {
    try {
      await onTogglePin(user.id, next)
    } catch (err) {
      onNotify(
        getErrorMessage(
          err,
          next ? `Não foi possível fixar ${user.name}` : `Não foi possível desfixar ${user.name}`
        ),
        true
      )
    }
  }

  // A lista dividida em ONLINE e OFFLINE (2026-09-25, pedido do usuário).
  //
  // Os dois grupos saem de uma passada só, e cada pessoa cai em
  // exatamente UM deles: o destino é decidido por `status === 'offline'`,
  // uma pergunta de sim ou não sobre o MESMO valor. Não há como alguém
  // aparecer nos dois nem sumir dos dois — pra isso seria preciso uma
  // segunda fonte de verdade, e não existe.
  //
  // Reativo: `presence` vem do WebSocket de salas, então alguém entrando
  // ou saindo do ar troca de grupo sozinho, sem nenhum refresh.
  //
  // Os arrays são NOVOS desde o começo (montados no laço), então o
  // `sort` — que ordena no lugar — não encosta no array que veio por
  // prop, que é o estado do hook lá na HomeScreen.
  const groups = useMemo(() => {
    const online: Entry[] = []
    const offline: Entry[] = []

    for (const user of users) {
      if (user.id === currentUserId) continue
      // Quem está offline não aparece no mapa de presença — é o que este
      // fallback cobre. E "ocupado" É online: é a preferência de quem
      // está no app, não uma ausência.
      const status: UserStatus = presence[user.id] ?? 'offline'
      const entry: Entry = { user, status, isPinned: pinned.has(user.id) }
      if (status === 'offline') offline.push(entry)
      else online.push(entry)
    }

    // A prioridade pedida, em três degraus: fixados primeiro; depois
    // disponíveis antes de ocupados; e o nome desempatando o resto.
    function compare(a: Entry, b: Entry): number {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      // Entre DOIS fixados a ordem é só o nome (decisão do usuário,
      // 2026-09-25): o bloco de fixados é curto e a pessoa sabe de cor
      // quem está nele, então o que ajuda é cada um ficar sempre no
      // mesmo lugar — e não eles se reorganizarem quando alguém fica
      // ocupado.
      if (!a.isPinned) {
        const peso = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (peso !== 0) return peso
      }
      // O servidor já devolve por `lower(username)`, mas o desempate
      // explícito não é redundante: sem ele a ordem dentro de cada
      // degrau ficaria à mercê da implementação do `sort`, e a lista
      // poderia embaralhar a cada mudança de presença de outra pessoa.
      return a.user.name.localeCompare(b.user.name, 'pt-BR')
    }

    online.sort(compare)
    offline.sort(compare)

    return [
      { key: 'online' as const, label: 'Online', entries: online },
      { key: 'offline' as const, label: 'Offline', entries: offline }
    ]
  }, [users, presence, currentUserId, pinned])

  // Só pra escolher entre a lista e o "não há ninguém". Grupo vazio some
  // INTEIRO, título incluído (pedido do usuário) — então com os dois
  // vazios não sobraria nada na tela, nem uma explicação.
  const total = groups[0].entries.length + groups[1].entries.length

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
      ) : total === 0 ? (
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
          {groups.map((group) =>
            // Grupo vazio não vira nem título (pedido do usuário): sem
            // ninguém online, a palavra "Online" sozinha ocuparia a
            // primeira linha da lista só pra dizer que não há nada ali.
            group.entries.length === 0 ? null : (
              <Fragment key={group.key}>
                {/* O título mora DENTRO do mesmo <ul> dos tiles, e não
                    num <ul> por grupo: é o que permite o `position:
                    sticky` do CSS: quem rola precisa ser o mesmo
                    elemento pros dois, senão cada título grudaria no
                    topo da sua própria caixa. */}
                <li className="users-group-header" role="presentation">
                  <span className="users-group-name">{group.label}</span>
                  {/* Quantos estão ali (pedido do usuário). O traço vai
                      junto no mesmo <span> do número pra nunca sobrar
                      sozinho no fim de uma linha. */}
                  <span className="users-group-count">- {group.entries.length}</span>
                </li>

                {group.entries.map(({ user, status, isPinned }) => {
                  // Convite só pra quem está logado (decisão do usuário):
                  // quem está offline não tem como receber, porque a
                  // entrega é pelo WebSocket dele.
                  const canInvite = Boolean(myRoomCode) && status !== 'offline'
                  // Convite no ar: o botão CONTINUA clicável (2026-09-14,
                  // pedido do usuário) — isto aqui só muda o texto da
                  // dica. Quem garante que ninguém seja incomodado duas
                  // vezes é o servidor, que ignora o clique quando já
                  // existe um convite de pé. Ver a rota de convite no
                  // server.js.
                  const waitingAnswer = pendingInvites.has(user.id)
                  // Esta sim ainda desabilita: não há o que convidar
                  // alguém que já está assistindo.
                  const alreadyWatching = myViewers.includes(user.name)
                  return (
                    <li
                      key={user.id}
                      className={`users-list-item${
                        card?.name === user.name ? ' user-tile-active' : ''
                      }${isPinned ? ' users-list-item-pinned' : ''}`}
                    >
                      {/* O alfinete de "está fixado". Decorativo de
                          propósito (`aria-hidden`): pra quem usa leitor
                          de tela a mesma informação já sai no
                          `aria-pressed` do botão de desfixar, e repetida
                          aqui viraria ruído a cada tile. */}
                      {isPinned && (
                        <span className="users-list-pin-badge" aria-hidden="true">
                          <Pin size={14} fill="currentColor" />
                        </span>
                      )}

                      {/* Avatar + nome viraram um botão (2026-09-13): clicar
                          abre a ficha do usuário. Os botões de ação ficam
                          FORA dele — convidar ou fixar não pode abrir ficha. */}
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

                      {/* Os dois botões num contêiner só, SEM o `gap` de
                          10px do tile (2026-09-25): é ele que dá o efeito
                          pedido — o alfinete cresce de 0 até a largura
                          cheia e EMPURRA o convite pra esquerda, em vez
                          de aparecer num espaço que já estava reservado
                          esperando por ele. */}
                      <span className="users-list-actions">
                        {canInvite && (
                          <Tooltip
                            label={
                              !liveReadyForInvites
                                ? 'Aguarde...'
                                : alreadyWatching
                                  ? 'Já está na sua live'
                                  : waitingAnswer
                                    ? 'Convite já enviado'
                                    : 'Enviar convite'
                            }
                            // ACIMA (2026-09-25, pedido do usuário). Antes
                            // abria pra direita (2026-09-14) pra fugir da
                            // borda da janela — este painel encosta na barra
                            // da esquerda, e pra aquele lado o balão era
                            // espremido. Em cima o problema não existe, e o
                            // balão para de cobrir os nomes da lista, que é o
                            // que ficava atrás dele quando abria pro lado.
                            placement="top"
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

                        {/* Quem anima é o SLOT, não o botão: ele tem
                            largura 0 em repouso e abre no hover (ver
                            main.css). O botão lá dentro mantém o tamanho
                            o tempo todo, então o ícone não estica nem
                            treme durante a transição. */}
                        <span className="users-list-pin-slot">
                          {/* Acima, igual ao do convite ao lado
                              (2026-09-25): os dois botoes sao vizinhos, e
                              balao de um abrindo pro lado e do outro pra
                              cima faria a mesma linha responder de dois
                              jeitos. */}
                          <Tooltip label={isPinned ? 'Desfixar' : 'Fixar'} placement="top">
                            <button
                              type="button"
                              className="users-list-pin"
                              onClick={() => handleTogglePin(user, !isPinned)}
                              // `aria-pressed` em vez de dois botões
                              // diferentes: é um botão que ALTERNA, e o
                              // leitor de tela anuncia o estado junto
                              // com o rótulo.
                              aria-pressed={isPinned}
                              aria-label={
                                isPinned ? `Desfixar ${user.name}` : `Fixar ${user.name} no topo`
                              }
                            >
                              {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                            </button>
                          </Tooltip>
                        </span>
                      </span>
                    </li>
                  )
                })}
              </Fragment>
            )
          )}
        </ul>
      )}

      {card && <UserCardPopover target={card} apiBaseUrl={apiBaseUrl} onClose={closeCard} />}
    </aside>
  )
}

export default UsersSidebar
