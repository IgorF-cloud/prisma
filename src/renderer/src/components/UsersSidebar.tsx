import { Fragment, useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, Eye, Pin, PinOff, Send } from 'lucide-react'
import { AvatarRef } from '../lib/avatar'
import { PresenceMap } from '../lib/useRooms'
import { getErrorMessage } from '../lib/errors'
import UserAvatar from './UserAvatar'
import UserCardPopover, { UserCardTarget } from './UserCardPopover'
import ContextMenu, { ContextMenuItem, ContextMenuPosition } from './ContextMenu'

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
  // Guardado aqui dentro, o "recusou" se perderia.
  //
  // Desde 2026-09-30 isto não aparece mais na tela: o menu não distingue
  // mais quem tem convite de pé. O único uso que restou é não reiniciar o
  // timeout de segurança quando o mesmo clique se repete (ver
  // `handleInvite`).
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

  // MENU DE AÇÕES do tile (2026-09-29, pedido do usuário). `null` =
  // nenhum aberto — e só um por vez, porque é um estado só pro painel
  // inteiro.
  //
  // Fixar e convidar eram dois botões na própria linha; viraram as duas
  // opções daqui, atrás de um único botão de chevron. A lista tem uma
  // coluna estreita e muitos nomes: dois controles por linha, vezes N
  // linhas, é uma parede de ícones — e nenhum deles é a ação principal
  // do tile, que é abrir a ficha.
  //
  // Guarda o USUÁRIO e não o id: os itens do menu precisam do nome (pros
  // rótulos e pras mensagens de erro) e do status (pra decidir se dá pra
  // convidar), e os dois já estão resolvidos aqui. O "está fixado" NÃO
  // vem guardado — é lido de `pinned` na hora de montar os itens, que é
  // a fonte viva.
  const [menu, setMenu] = useState<{
    user: DirectoryUser
    status: UserStatus
    position: ContextMenuPosition
  } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

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
    // ...e por morrer aqui, ele também não chega ao listener que fecha o
    // MENU de ações — que é o mesmo mecanismo, no ContextMenu (defeito
    // relatado pelo usuário em 2026-09-29: com o menu aberto, clicar num
    // tile abria a ficha e o menu ficava pendurado na tela).
    //
    // Fechar aqui, na mão, e não trocar o listener do ContextMenu pra
    // fase de captura: em captura ele fecharia o menu ANTES do
    // handleMenuClick abaixo, e o clique no próprio chevron passaria a
    // reabrir o que acabou de fechar — o botão nunca mais alternaria.
    // Este é o único clique do painel que interrompe a subida do evento,
    // então é o único lugar que precisa disto.
    setMenu(null)
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

  // Abre o menu ancorado no botão de chevron do tile.
  function handleMenuClick(
    event: React.MouseEvent<HTMLButtonElement>,
    user: DirectoryUser,
    status: UserStatus
  ): void {
    // Pelo mesmo motivo do clique do tile: o menu fecha por um listener
    // de clique no documento, e sem isto o próprio clique que o abre
    // chegaria lá e o fecharia no mesmo instante.
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    // Abre logo ABAIXO do botão, alinhado pela esquerda dele — o
    // ContextMenu espelha sozinho se não couber. Ancorado no botão e não
    // no cursor porque este menu não é de botão direito: ele tem um alvo
    // visível, e sair de baixo dele é o que liga uma coisa à outra.
    const position = { x: rect.left, y: rect.bottom + 6 }
    // A ficha do usuário e o menu ocupam o mesmo canto da tela; abrir um
    // fecha o outro.
    setCard(null)
    setMenu((current) => (current?.user.id === user.id ? null : { user, status, position }))
  }

  async function handleInvite(user: DirectoryUser): Promise<void> {
    if (!myRoomCode || !liveReadyForInvites) return
    // Lido ANTES do await: o `onInvited` logo abaixo entra neste mesmo
    // conjunto, e depois da ida ao servidor não dá mais pra distinguir a
    // pendência de antes da que este clique acabou de criar.
    const jaPendente = pendingInvites.has(user.id)
    try {
      // A chamada sai mesmo com um convite de pé. Quem decide se ela vira
      // um convite novo é o servidor, e só ele sabe: este conjunto aqui é
      // um espelho que pode estar velho (um resultado perdido numa
      // reconexão, por exemplo), e curto-circuitar por ele arriscaria
      // engolir pra sempre um convite legítimo.
      await window.api.users.invite(myRoomCode, user.id)
      // Só no PRIMEIRO. Repetir `markInvited` reiniciaria o timeout de
      // segurança daqui (ver useInviteTracking) a cada clique, enquanto o
      // convite de verdade continua expirando na hora dele — a tela
      // ficaria esperando a resposta de um convite que já morreu.
      if (!jaPendente) onInvited(user.id)
      // O aviso sai sempre igual, mesmo quando o servidor ignorou: é o
      // mesmo motivo de o rótulo não mudar mais — um "já havia um convite"
      // aqui contaria justamente o que se decidiu não contar.
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

  // OS ITENS DO MENU de um tile (2026-09-29). Fora do laço da lista de
  // propósito: só existe um menu aberto por vez, então montar isto por
  // tile seria montar N listas pra usar uma.
  //
  // Uma função e não um `useMemo`: ela roda uma vez por render, e só
  // quando há menu aberto. E tudo que ela lê — `pinned`, `myViewers`,
  // `pendingInvites` — é lido AQUI, e não no clique que abriu o menu: ele
  // fica aberto enquanto gente entra e sai da live, e um retrato tirado
  // no clique já estaria velho.
  function menuItemsFor(target: { user: DirectoryUser; status: UserStatus }): ContextMenuItem[] {
    const { user, status } = target
    const isPinned = pinned.has(user.id)

    // Fixar vem primeiro: é a ação que vale pra QUALQUER pessoa da lista,
    // inclusive offline. A de convidar depende de eu estar ao vivo, e um
    // menu que abre com o primeiro item apagado parece um menu quebrado.
    const items: ContextMenuItem[] = [
      {
        label: isPinned ? 'Desfixar' : 'Fixar no topo',
        icon: isPinned ? <PinOff size={14} /> : <Pin size={14} />,
        onSelect: () => handleTogglePin(user, !isPinned)
      }
    ]

    if (myViewers.includes(user.name)) {
      // Não é um item apagado, é uma LINHA DE INFORMAÇÃO: apagado diria
      // "não dá pra convidar agora", e a verdade é outra — não há o que
      // convidar, a pessoa já está lá dentro.
      items.push({ label: 'Já assistindo sua live', icon: <Eye size={14} />, info: true })
      return items
    }

    // A ordem das três razões é a ordem em que elas travam: sem live não
    // há pra onde convidar; com a live subindo, o servidor ainda não
    // registrou a sala (ver `liveReadyForInvites` na HomeScreen); e quem
    // está offline não tem como receber, porque a entrega é pelo
    // WebSocket dele.
    const motivo = !myRoomCode
      ? 'Você não está ao vivo'
      : !liveReadyForInvites
        ? 'Aguarde a live entrar no ar'
        : status === 'offline'
          ? 'Está offline'
          : null
    // Convite pendente NÃO aparece no menu (2026-09-30, pedido do
    // usuário; antes o item virava "Convidar de novo" com a dica "Convite
    // já enviado"). O item é sempre o mesmo e sempre clicável: quem
    // convida não precisa saber que o clique de agora não mandou nada.
    //
    // A regra de UM convite de pé por pessoa continua valendo — ela mora
    // no servidor, que ignora o pedido enquanto o anterior não for
    // respondido, e o relógio de 30s de quem recebeu segue correndo do
    // primeiro. O que muda é só o que a tela conta (ver também o guarda
    // em `handleInvite`, que evita esticar o relógio DAQUI a cada clique).
    items.push({
      label: 'Convidar para a live',
      icon: <Send size={14} />,
      hint: motivo ?? undefined,
      disabled: Boolean(motivo),
      onSelect: () => handleInvite(user)
    })

    return items
  }

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
                  // A única coisa que o TILE ainda precisa saber sobre
                  // convite (2026-09-29): quem pode ou não ser convidado,
                  // e por quê, virou decisão do menu — ver `menuItems`.
                  const alreadyWatching = myViewers.includes(user.name)
                  // O menu deste tile está aberto: o tile fica realçado e
                  // o botão de chevron não se recolhe enquanto isso, mesmo
                  // com o mouse longe dali.
                  const menuOpen = menu?.user.id === user.id
                  return (
                    <li
                      key={user.id}
                      className={`users-list-item${
                        card?.name === user.name || menuOpen ? ' user-tile-active' : ''
                      }${isPinned ? ' users-list-item-pinned' : ''}`}
                    >
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
                          {/* A SOBRANCELHA de "está na minha live"
                              (2026-09-29, pedido do usuário): uma linha
                              curta ACIMA do nome, verde, com o ponto que
                              respira.

                              Acima e não no lugar do status: "Online" e
                              "está assistindo" são duas coisas
                              diferentes, e a segunda não substitui a
                              primeira. Em cima porque é o que muda
                              enquanto a live corre — o olho pega a linha
                              antes de chegar no nome, que é o dado fixo.

                              Minúscula (9px) e em versalete de
                              propósito: ela empurra o tile ~11px pra
                              baixo, e só nos tiles de quem está
                              assistindo. Maior que isso, a lista perderia
                              o ritmo toda vez que alguém entrasse na
                              live. */}
                          {alreadyWatching && (
                            <span className="users-list-eyebrow">
                              <span className="users-list-watching-dot" />
                              {/* O texto num <span> próprio, e não solto
                                  na linha: `text-overflow: ellipsis` não
                                  vale pro texto anônimo de um contêiner
                                  flex. Sem ele, o rótulo seria cortado no
                                  meio de uma letra no tile mais apertado
                                  da lista (fixado, com o menu aberto) em
                                  vez de terminar em reticências. */}
                              <span className="users-list-eyebrow-text">Assistindo sua live</span>
                            </span>
                          )}
                          <span className="users-list-name">{user.name}</span>
                          <span className="users-list-status">{STATUS_LABEL[status]}</span>
                        </span>
                      </button>

                      {/* A coluna de ações do tile, SEM o `gap` de 10px da
                          linha (2026-09-25): é ele que dá o efeito de o
                          botão de menu crescer de 0 até a largura cheia e
                          EMPURRAR o que estiver à esquerda, em vez de
                          aparecer num espaço que já estava reservado
                          esperando por ele.

                          (O `gap` da linha continua valendo entre o nome e
                          este bloco, então todo tile reserva os mesmos
                          10px no fim — inclusive os de quem está offline.
                          É de propósito: os nomes passam a truncar no
                          mesmo ponto em toda a lista.) */}
                      <span className="users-list-actions">
                        {/* "ESTÁ FIXADO" é só um ÍCONE (2026-09-29, pedido
                            do usuário): alfinete pequeno, cinza e
                            preenchido, sem fundo, sem borda e sem hover —
                            não é botão, e não deve parecer um. Quem
                            desfixa é o menu ao lado.

                            Cinza e não âmbar porque o âmbar já está no
                            tile inteiro (ver `.users-list-item-pinned`):
                            repetido no ícone, ele viraria a terceira
                            coisa amarela da mesma linha. Preenchido é o
                            que faz um ícone de 13px sobreviver sem cor —
                            o contorno vazado do lucide some nesse
                            tamanho.

                            `aria-hidden` porque a mesma informação já sai
                            no rótulo do botão de menu ao lado; repetida,
                            viraria ruído a cada tile. */}
                        {isPinned && (
                          <span className="users-list-pin-mark" aria-hidden="true">
                            <Pin size={13} fill="currentColor" />
                          </span>
                        )}

                        {/* Quem anima é o SLOT, não o botão: ele tem
                            largura 0 em repouso e abre no hover (ver
                            main.css). O botão lá dentro mantém o tamanho o
                            tempo todo, então o ícone não estica nem treme
                            durante a transição. */}
                        <span className="users-list-menu-slot">
                          <button
                            type="button"
                            className="users-list-menu-button"
                            onClick={(event) => handleMenuClick(event, user, status)}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            aria-label={`Ações para ${user.name}`}
                          >
                            <ChevronDown size={14} />
                          </button>
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

      {menu && (
        <ContextMenu position={menu.position} items={menuItemsFor(menu)} onClose={closeMenu} />
      )}
    </aside>
  )
}

export default UsersSidebar
