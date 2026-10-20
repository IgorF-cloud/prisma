import { useEffect, useRef, useState } from 'react'
import { Cast, Eye, Plus, RefreshCw, Tv, Users } from 'lucide-react'
import { RoomInfo } from '../lib/useRooms'
import { AvatarRef } from '../lib/avatar'
import { AuthUser } from '../lib/authUser'
import UserAvatar from './UserAvatar'
import UserProfileModal from './UserProfileModal'
import Tooltip from './Tooltip'

interface AppLeftSidebarProps {
  // Já vem filtrada pela HomeScreen (`visibleRooms`): toda sala que
  // existe está ao vivo — uma sala só existe no LiveKit enquanto o host
  // transmite — e a MINHA própria sala fica de fora (item 38, ver
  // useHiddenOwnRoomCode.ts).
  rooms: RoomInfo[]
  userAvatars: Record<string, AvatarRef>
  user: AuthUser
  apiBaseUrl: string
  // Ainda não faz nada (pedido do usuário: "deixa o parâmetro vazio por
  // enquanto"). Fica declarado pra deixar claro onde o comportamento
  // entra depois — provavelmente entrar/focar a sala.
  onRoomClick: (room: RoomInfo) => void
  // Sala com a sub-barra de detalhes aberta — ganha a barrinha branca
  // fixa, em altura cheia. null quando os detalhes estão fechados.
  activeRoomCode: string | null
  // Salas cujo vídeo EU estou recebendo agora (2026-09-14, pedido do
  // usuário). Não confundir com `activeRoomCode`, que é a sala com o
  // painel de detalhes aberto: dá pra assistir sem o painel aberto e
  // vice-versa.
  watchingRoomCodes: string[]
  // Tile fixo do topo: abre a sub-barra com os usuários do app.
  onUsersClick: () => void
  usersActive: boolean
  // Recarrega a lista de salas por HTTP, num caminho separado do
  // WebSocket de tempo real (ver useRooms.ts/rooms.ts) — é a rede de
  // segurança pra quando o tempo real está com problema. Veio da
  // sidebar antiga, que era onde este botão morava.
  refreshingRooms: boolean
  onRefreshRooms: () => void
  // Item 9: abre o modal de entrar por código.
  onJoinByCode: () => void
  // "Transmitir" (2026-09-13): era um pill com texto no canto direito
  // do rodapé; virou este tile circular, logo acima do avatar. Mesma
  // função, só mudou de lugar e ganhou destaque.
  onNavigateTransmission: () => void
  // Chamado quando o ponteiro ENCOSTA no botão de transmitir, antes de
  // qualquer clique (2026-10-13). Quem recebe usa isso pra adiantar o
  // trabalho da tela que vem — ver `onPrepareTransmission` em
  // HomeScreen.tsx. Daqui não se sabe o que é esse trabalho, e é de
  // propósito: a barra lateral não tem assunto com captura de tela.
  onPrepareTransmission: () => void
  // Some enquanto há live no ar — aí o rodapé mostra os controles de
  // parar/atualizar, e um atalho pra "começar" no meio disso só
  // confundiria. Mesmo comportamento do botão antigo.
  transmitting: boolean
  onOpenSettings: () => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
  // Abre a janela de perfil (2026-10-19). Repassado ao popover; quem
  // renderiza a janela é a HomeScreen, pelo mesmo motivo das
  // Configurações. Substituiu o `onNotify`, que só existia pro upload de
  // foto que o popover fazia.
  onOpenProfile: () => void
}

// Item 5 do roadmap, 1ª parte (2026-09-09) — a barra vertical fina da
// esquerda ("SALAS AO VIVO"): só os avatares redondos dos hosts que estão
// transmitindo, e o avatar do usuário logado fixo no rodapé.
//
// Substituiu a `.rooms-sidebar` de 285px, removida em 2026-09-09. Ela
// conviveu com esta barra por um tempo (o usuário pediu pra montar o
// layout novo primeiro e só depois remover), e nesse período o popover
// de perfil existiu nos dois lugares — hoje o único é o daqui.
function AppLeftSidebar({
  rooms,
  userAvatars,
  user,
  apiBaseUrl,
  onRoomClick,
  activeRoomCode,
  watchingRoomCodes,
  onUsersClick,
  usersActive,
  refreshingRooms,
  onRefreshRooms,
  onJoinByCode,
  onNavigateTransmission,
  onPrepareTransmission,
  transmitting,
  onOpenSettings,
  onUserUpdate,
  onLogout,
  onOpenProfile
}: AppLeftSidebarProps): React.JSX.Element {
  const [profileOpen, setProfileOpen] = useState(false)
  // Mesmo padrão da sidebar antiga: o ref envolve o botão E o popover,
  // pra "clicou fora" conseguir distinguir os dois sem caçar classe. O
  // popover não pode ser filho do botão — `:hover` pegaria ele como
  // descendente e o botão ficaria aceso com o popover aberto.
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!profileOpen) return
    function handleOutsideClick(event: MouseEvent): void {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [profileOpen])

  return (
    <aside className="app-left-sidebar">
      {/* Fixo no topo, fora da lista rolável abaixo. Usa a mesma classe
          dos tiles de sala pra herdar a barrinha branca de hover/seleção
          e as medidas — o que muda é o miolo do círculo. */}
      <Tooltip label="Usuários" placement="right" delayMs={0}>
        <button
          type="button"
          className={`app-left-sidebar-live${
            usersActive ? ' app-left-sidebar-live-active' : ''
          }`}
          onClick={onUsersClick}
          aria-label="Usuários"
        >
          <span className="app-left-sidebar-users-icon">
            <Users size={20} />
          </span>
        </button>
      </Tooltip>

      <div className="app-left-sidebar-divider" />

      <div className="app-left-sidebar-lives">
        {/* Zero salas não pode parecer "quebrou". A barra é estreita
            demais pra texto, então o sinal é um círculo tracejado com
            tooltip — some assim que alguém abre uma live. */}
        {rooms.length === 0 && (
          <Tooltip label="Ninguém ao vivo agora" placement="right" delayMs={0}>
            <span className="app-left-sidebar-empty" aria-label="Ninguém ao vivo agora">
              <Tv size={20} />
            </span>
          </Tooltip>
        )}

        {rooms.map((room) => {
          // Sem host conhecido o texto nao pode virar "Live de undefined".
          const liveLabel = room.hostName ? `Live de ${room.hostName}` : 'Sala ao vivo'
          const watching = watchingRoomCodes.includes(room.name)
          return (
            <Tooltip key={room.name} label={liveLabel} placement="right" delayMs={0}>
              <button
                type="button"
                className={`app-left-sidebar-live${
                  room.name === activeRoomCode ? ' app-left-sidebar-live-active' : ''
                }`}
                onClick={() => onRoomClick(room)}
                aria-label={liveLabel}
              >
                <span className="app-left-sidebar-avatar">
                  <UserAvatar
                    avatar={room.hostName ? userAvatars[room.hostName] : null}
                    apiBaseUrl={apiBaseUrl}
                    size={20}
                  />
                </span>
                {/* Marca "ao vivo" no canto de cima do círculo. Era um
                    dot verde à direita até 2026-09-13; virou este selo
                    escrito, à esquerda, a pedido do usuário — ver
                    `.app-left-sidebar-live-pill` no CSS pro porquê da cor
                    e do lado. */}
                <span className="app-left-sidebar-live-pill">LIVE</span>

                {/* "Você está assistindo esta" (2026-09-14, pedido do
                    usuário). Canto de baixo, do lado oposto ao selo
                    LIVE: os dois falam de coisas diferentes — aquele é
                    sobre a SALA, este é sobre MIM — e juntos no mesmo
                    canto viraria uma coisa só, ilegível nos 36px do
                    círculo. */}
                {watching && (
                  <span className="app-left-sidebar-watching-badge">
                    <Eye size={11} />
                  </span>
                )}
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* Rodapé: entrar com código, atualizar a lista e o perfil. Os dois
          primeiros ficam ACIMA do avatar porque o avatar é a âncora do
          popover de perfil — um irmão embaixo dele empurraria o cálculo
          de posição. */}
      <Tooltip label="Entrar com código" placement="right" delayMs={0}>
        <button
          type="button"
          className="app-left-sidebar-plain"
          onClick={onJoinByCode}
          aria-label="Entrar com código"
        >
          <span className="app-left-sidebar-users-icon">
            <span className="app-left-sidebar-add-badge">
              <Plus size={12} strokeWidth={3.5} />
            </span>
          </span>
        </button>
      </Tooltip>

      <Tooltip label="Atualizar lista de salas" placement="right" delayMs={0}>
        <button
          type="button"
          className="app-left-sidebar-plain"
          onClick={onRefreshRooms}
          disabled={refreshingRooms}
          aria-label="Atualizar lista de salas"
        >
          <span className="app-left-sidebar-users-icon">
            <RefreshCw size={20} className={refreshingRooms ? 'icon-spinning' : undefined} />
          </span>
        </button>
      </Tooltip>

      {!transmitting && (
        <Tooltip label="Transmitir" placement="right" delayMs={0}>
          <button
            type="button"
            className="app-left-sidebar-cast"
            onClick={onNavigateTransmission}
            // Os dois eventos, não só o do mouse: `onFocus` é o mesmo
            // aviso pra quem chega no botão pelo teclado.
            onPointerEnter={onPrepareTransmission}
            onFocus={onPrepareTransmission}
            aria-label="Transmitir"
          >
            <Cast size={20} />
          </button>
        </Tooltip>
      )}

      <div ref={profileRef} className="app-left-sidebar-profile-wrapper">
        <Tooltip label={user.name} placement="right" delayMs={0}>
          <button
            type="button"
            className="app-left-sidebar-profile"
            onClick={() => setProfileOpen((open) => !open)}
            aria-label="Abrir perfil"
          >
            <span className="app-left-sidebar-avatar">
              <UserAvatar avatar={user.avatar} apiBaseUrl={apiBaseUrl} size={20} />
            </span>
            {/* FORA do `.app-left-sidebar-avatar`, que tem
                `overflow: hidden` — dentro, o dot seria cortado pela
                borda do círculo. Ancorado no botão, que já é
                `position: relative`. */}
            <span
              className={`user-status-dot user-status-${
                user.presence === 'busy' ? 'busy' : 'online'
              }`}
            />
          </button>
        </Tooltip>

        {profileOpen && (
          <UserProfileModal
            user={user}
            apiBaseUrl={apiBaseUrl}
            onClose={() => setProfileOpen(false)}
            onUserUpdate={onUserUpdate}
            onLogout={onLogout}
            onOpenProfile={onOpenProfile}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
    </aside>
  )
}

export default AppLeftSidebar
