import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Eye,
  Lock,
  MessageSquare,
  MessageSquareOff,
  X
} from 'lucide-react'
import { RoomInfo } from '../lib/useRooms'
import { ChatRoomState } from '../lib/useLiveChat'
import { AvatarRef } from '../lib/avatar'
import LiveChat from './LiveChat'
import UserAvatar from './UserAvatar'
import ViewerAvatarRow from './ViewerAvatarRow'
import NowPlayingArt from './NowPlayingArt'
import MarqueeText from './MarqueeText'
import LiveTimer from './LiveTimer'
import UserCardPopover, { UserCardStatus, UserCardTarget } from './UserCardPopover'

interface RoomDetailsSidebarProps {
  room: RoomInfo
  userAvatars: Record<string, AvatarRef>
  apiBaseUrl: string
  // Se EU já estou recebendo o feed desta sala. Não é a mesma coisa que
  // ter o painel aberto: o painel é só a ficha da sala.
  isWatching: boolean
  // Status por NOME (2026-09-13), pra ficha de quem está assistindo.
  //
  // Vem pronto de fora porque a conversão custa uma junção que este
  // componente não tem como fazer: a lista de viewers é de nomes, e o
  // mapa de presença é por id — quem casa os dois é o diretório de
  // contas, que vive na HomeScreen.
  statusByName: Record<string, UserCardStatus>
  onClose: () => void
  onWatch: () => void
  // Sair da live sem precisar achar o tile dela na grade (2026-09-20)
  // — ver o bloco "Assistindo" no corpo.
  onLeave: () => void
  // Item 21 (chat da live, 2026-09-23). `null` quando não estou
  // assistindo esta sala: decisão do usuário — a aba de chat só existe
  // pra quem está na live, então sem isso ela nem é renderizada.
  chat: ChatRoomState | null
  selfName: string
  onSendChat: (text: string) => Promise<boolean>
  onChatOpened: () => void
}

// Item 5 do roadmap, 2ª parte (2026-09-09) — a sub-barra de DETALHES da
// sala, que aparece ao clicar num avatar da barra de salas ao vivo.
//
// A separação que dá sentido ao componente: abrir este painel NÃO entra na
// live. Aqui só se olha a ficha da sala (o que está sendo transmitido, há
// quanto tempo, quem está assistindo); receber o feed é o botão
// "Assistir", e as duas coisas são independentes — fechar o painel na
// seta não derruba a live, e sair da live continua sendo pelo botão do
// próprio tile dela (ver ViewerTile.tsx).
//
// Quem controla se este painel existe é a HomeScreen (`sidePanel`):
// quando a sala some da lista em tempo real — host encerrou —, ela para de
// renderizar isto sozinha, sem precisar de limpeza de estado aqui.
function RoomDetailsSidebar({
  room,
  userAvatars,
  apiBaseUrl,
  isWatching,
  statusByName,
  onClose,
  onWatch,
  onLeave,
  chat,
  selfName,
  onSendChat,
  onChatOpened
}: RoomDetailsSidebarProps): React.JSX.Element {
  const viewers = room.participants.filter((p) => p !== room.hostName)

  // Chat da live (item 21, 2026-09-23). Começa FECHADO: a ficha da sala
  // é sobre a sala, e o chat é uma escolha de quem quer conversar.
  //
  // Aberto, ele SOBE até a linha do "Assistindo" e a lista de
  // espectadores colapsa numa fila de avatares acima dele (2026-09-23) —
  // os dois disputam o mesmo `flex: 1` da barra, e mostrar os dois
  // inteiros espremidos não serviria bem a nenhum dos dois. A lista não
  // some: vira o resumo mínimo que ainda responde "quem está aqui?".
  const [chatEscolhido, setChatOpen] = useState(false)

  // DERIVADO, e não sincronizado por efeito — mesmo padrão do
  // `popinRoomCode` em App.tsx, e a regra do projeto proíbe `setState`
  // dentro de efeito.
  //
  // Parar de assistir tira o chat (`chat` vira null) e a aba some no
  // MESMO render. Um efeito que zerasse o estado faria isso um render
  // depois, e nesse meio tempo a aba ficaria pendurada numa live da
  // qual já saí. Voltando a assistir, o chat reabre como estava — que é
  // o que se espera de quem estava conversando ali.
  const chatOpen = chatEscolhido && Boolean(chat)

  // Zera o badge de não lidas assim que o chat fica visível.
  useEffect(() => {
    if (chatOpen) onChatOpened()
  }, [chatOpen, onChatOpened, chat?.unread])

  // Ficha de quem está assistindo (2026-09-13) — mesmo componente e
  // mesmo comportamento da lista de usuários; ver UsersSidebar.tsx
  // pro porquê do stopPropagation e da medida antes do setState.
  const [card, setCard] = useState<UserCardTarget | null>(null)
  const closeCard = useCallback(() => setCard(null), [])

  function handleViewerClick(event: React.MouseEvent<HTMLButtonElement>, name: string): void {
    event.stopPropagation()
    // Ancora no <li> e não no botão — ver UsersSidebar.tsx.
    const tile = event.currentTarget.closest('li') ?? event.currentTarget
    const rect = tile.getBoundingClientRect()
    setCard((current) =>
      current?.name === name
        ? null
        : {
            name,
            avatar: userAvatars[name] ?? null,
            status: statusByName[name] ?? 'offline',
            rect
          }
    )
  }
  // O PIN de sala saiu em 2026-09-10, e com ele o estado "trancado":
  // uma sala privada nem chega até aqui pra quem não foi convidado (o
  // servidor filtra no broadcast), então tudo que este painel mostra já
  // é conteúdo que a pessoa pode ver.

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <div className="side-panel-heading">
          <span className="side-panel-title">Live de {room.hostName ?? '???'}</span>
          <span className="room-details-subline">
            <LiveTimer startedAt={room.startedAt} className="room-details-timer" />
            {/* Só quem foi convidado recebe uma sala privada na lista, então
                quem está vendo isto já tem acesso — o selo é informativo,
                não um cadeado. */}
            {room.private && (
              <span className="room-details-private">
                <Lock size={11} />
                Privada
              </span>
            )}
          </span>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar detalhes da sala"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* O que está sendo transmitido. A arte vem do `iconUrl` que o host
          reporta junto do jogo (ver gameDetection.ts) e que o servidor já
          reenvia pra todo mundo na lista de salas — nada aqui é buscado à
          parte. Sem arte, o NowPlayingArt cai no placeholder certo pro
          tipo (jogo / janela / monitor).

          Nada detectado ainda: não renderiza NADA (pedido do usuário,
          2026-09-09). O bloco tem `min-height`, então um placeholder aqui
          deixaria um vazio de 44px no meio da ficha — pior do que o botão
          "Assistir" simplesmente subir. */}
      {room.game && (
        <div className="room-details-now-playing">
          <NowPlayingArt info={room.game} />
          <div className="room-details-now-playing-text">
            <span className="room-details-label">
              {room.game.kind === 'game' ? 'Jogando' : 'Transmitindo'}
            </span>
            <MarqueeText text={room.game.name} className="room-details-game" />
          </div>
        </div>
      )}

      {/* JÁ ASSISTINDO vira uma LINHA, não um botão apagado (2026-09-20,
          pedido do usuário). Um botão desabilitado comunica "não dá pra
          clicar" quando a mensagem real é outra: "você já está aqui, e
          pode sair". A saída fica do lado direito, que é onde ações
          destrutivas moram no resto do app. */}
      {isWatching ? (
        <div className="room-details-watching">
          <Eye size={15} />
          Assistindo
          {/* Dentro do chip, encostado na ponta direita: a saída pertence
              a este estado, não é uma ação solta ao lado dele. Sem fundo
              nem borda de propósito — o chip já é a "caixa", e um botão
              dentro de outro botão pesaria a ficha inteira. */}
          <button
            type="button"
            className="room-details-leave"
            onClick={onLeave}
            aria-label="Sair da live"
          >
            <X size={14} />
            Sair
          </button>
        </div>
      ) : (
        <button type="button" className="room-details-watch" onClick={onWatch}>
          <Eye size={15} />
          Assistir
        </button>
      )}

      {/* Só a LISTA colapsa quando o chat abre (2026-09-23, 2ª rodada de
          desenho). A linha de cima — "Assistindo" + contador — fica
          exatamente como sempre foi; quem vira a FILA DE AVATARES
          sobrepostos, animada, é a lista vertical embaixo dela.

          É animado dos dois lados e sem `hidden`: o bloco continua no
          fluxo, só muda de tamanho (`flex-grow` + `min-height`), então o
          navegador interpola os dois estados em vez de trocar um pelo
          outro num quadro. Ver `.room-details-viewers-collapsed` no CSS.

          Por que `flex-grow` e não `height`: a altura aqui é a sobra do
          painel, um número que nem o React nem o CSS conhecem de
          antemão — animar o quanto o bloco PUXA dessa sobra funciona
          sem precisar medir nada. */}
      <div
        className={
          chatOpen ? 'room-details-viewers room-details-viewers-collapsed' : 'room-details-viewers'
        }
      >
        <span className="room-details-label">
          Assistindo
          {viewers.length > 0 && <span className="room-details-count">{viewers.length}</span>}
        </span>

        {/* A lista e a fila ocupam O MESMO retângulo, sobrepostas (as duas
            são absolutas dentro daqui) — é isso que deixa uma virar a
            outra por opacidade enquanto a altura do bloco anima. Empilhar
            as duas no fluxo faria a fila "cair" quando a lista saísse. */}
        <div className="room-details-viewers-body">
          <div className="room-details-viewers-layer">
            {viewers.length === 0 ? (
              <p className="room-details-empty">Ninguém assistindo ainda.</p>
            ) : (
              <ul
                className="room-details-viewers-list viewers-list"
                // Mesma barra sob demanda da lista de usuários — ver o
                // comentário lá e o bloco em main.css.
                onMouseEnter={(e) => e.currentTarget.classList.add('scroll-visible')}
                onMouseLeave={(e) => e.currentTarget.classList.remove('scroll-visible')}
              >
                {viewers.map((name) => (
                  <li key={name} className={card?.name === name ? 'user-tile-active' : undefined}>
                    <button
                      type="button"
                      className="user-tile-button"
                      onClick={(event) => handleViewerClick(event, name)}
                      tabIndex={chatOpen ? -1 : 0}
                      aria-label={`Ver perfil de ${name}`}
                    >
                      <span className="mini-avatar">
                        <UserAvatar avatar={userAvatars[name]} apiBaseUrl={apiBaseUrl} size={13} />
                      </span>
                      <span className="viewer-name">{name}</span>
                      {/* Silenciado no chat (2026-09-23): balão cortado, em
                        vermelho. O host precisa ver quem ele calou, e os
                        outros precisam entender por que aquela pessoa
                        parou de falar. */}
                      {chat?.mutedNames.has(name) && (
                        <MessageSquareOff
                          size={12}
                          className="viewer-muted-badge"
                          aria-label="Silenciado no chat"
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* A fila do estado colapsado. Existe SEMPRE no DOM (invisível
              enquanto o chat está fechado) — montá-la só na hora tiraria
              o que animar, daí o `interactive` em vez de um `&&`. */}
          <ViewerAvatarRow
            names={viewers}
            userAvatars={userAvatars}
            apiBaseUrl={apiBaseUrl}
            interactive={chatOpen}
            mutedNames={chat?.mutedNames}
            activeName={card?.name ?? null}
            onViewerClick={handleViewerClick}
          />
        </div>
      </div>

      {/* CHAT DA LIVE (item 21, 2026-09-23) — o lugar que o comentário
          antigo daqui já reservava.

          Só existe pra quem está assistindo (decisão do usuário): sem
          `chat`, a barra termina na lista de espectadores como sempre
          terminou. */}
      {chat && (
        <div className={chatOpen ? 'room-chat room-chat-open' : 'room-chat'}>
          <button
            type="button"
            // TEM MENSAGEM NOVA = a ABA INTEIRA acende em laranja e pulsa
            // (2026-09-29, pedido do usuário), no lugar do badge vermelho
            // com o número de não lidas que ficava aqui.
            //
            // A troca é a mesma que a casca fechada do host já tinha
            // feito (ver `.host-chat-bar-button-unread`): o vermelho é a
            // cor de erro/perigo no resto do app, e mensagem no chat não
            // é nem uma coisa nem outra. E o NÚMERO não mudava nenhuma
            // decisão — fechada, o que importa é "tem gente falando"; a
            // contagem exata está a um clique.
            className={
              !chatOpen && chat.unread > 0 ? 'room-chat-tab room-chat-tab-unread' : 'room-chat-tab'
            }
            onClick={() => setChatOpen((open) => !open)}
            aria-expanded={chatOpen}
          >
            <MessageSquare size={13} />
            <span className="room-chat-tab-label">Chat ao vivo</span>
            {/* O aviso só faz sentido fechado — aberto, a pessoa está
                lendo as mensagens que ele anunciaria.

                O ponto é só COR e movimento, sem texto nenhum: quem usa
                leitor de tela depende do `aria-label`, daí ele existir
                aqui e dizer o que o desenho não diz. */}
            {!chatOpen && chat.unread > 0 && (
              <span className="room-chat-tab-dot" role="img" aria-label="Mensagens não lidas" />
            )}
            {chatOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>

          {chatOpen && (
            <LiveChat
              messages={chat.messages}
              loading={chat.loading}
              mutedNames={chat.mutedNames}
              userAvatars={userAvatars}
              apiBaseUrl={apiBaseUrl}
              onSend={onSendChat}
              selfName={selfName}
            />
          )}
        </div>
      )}

      {card && <UserCardPopover target={card} apiBaseUrl={apiBaseUrl} onClose={closeCard} />}
    </aside>
  )
}

export default RoomDetailsSidebar
