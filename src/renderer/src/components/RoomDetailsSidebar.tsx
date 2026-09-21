import { useCallback, useState } from 'react'
import { ChevronLeft, Eye, Lock, X } from 'lucide-react'
import { RoomInfo } from '../lib/useRooms'
import { AvatarRef } from '../lib/avatar'
import UserAvatar from './UserAvatar'
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
  onLeave
}: RoomDetailsSidebarProps): React.JSX.Element {
  const viewers = room.participants.filter((p) => p !== room.hostName)

  // Ficha de quem está assistindo (2026-09-13) — mesmo componente e
  // mesmo comportamento da lista de usuários; ver UsersSidebar.tsx
  // pro porquê do stopPropagation e da medida antes do setState.
  const [card, setCard] = useState<UserCardTarget | null>(null)
  const closeCard = useCallback(() => setCard(null), [])

  function handleViewerClick(
    event: React.MouseEvent<HTMLButtonElement>,
    name: string
  ): void {
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

      <div className="room-details-viewers">
        <span className="room-details-label">
          Assistindo
          {viewers.length > 0 && (
            <span className="room-details-count">{viewers.length}</span>
          )}
        </span>

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
                  aria-label={`Ver perfil de ${name}`}
                >
                  <span className="mini-avatar">
                    <UserAvatar
                      avatar={userAvatars[name]}
                      apiBaseUrl={apiBaseUrl}
                      size={13}
                    />
                  </span>
                  <span className="viewer-name">{name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Rodapé de COMENTÁRIOS entra aqui depois (pedido do usuário:
          "isso não precisa fazer agora"). O layout já reserva o lugar — a
          lista de viewers acima é quem tem o `flex: 1`, então a seção de
          comentários vai encostar no rodapé sem precisar remexer no
          resto. */}

      {card && (
        <UserCardPopover target={card} apiBaseUrl={apiBaseUrl} onClose={closeCard} />
      )}
    </aside>
  )
}

export default RoomDetailsSidebar
