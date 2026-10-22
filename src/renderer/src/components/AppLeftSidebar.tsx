import { useEffect, useRef, useState } from 'react'
import { Cast, Eye, HeartHandshake, RefreshCw, Tv } from 'lucide-react'
import UserGroupIcon from './UserGroupIcon'
import { WebcamStatus } from '../lib/useWebcamTransmission'
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
  // Tile fixo do topo: abre a LISTA DE AMIGOS (era a de usuários até
  // 2026-10-21 — todo mundo agora está nos Membros, na titlebar).
  onUsersClick: () => void
  usersActive: boolean
  // Pedidos de amizade RECEBIDOS esperando resposta — o selo do tile.
  incomingRequests: number
  // MEMBROS (2026-10-21): o tile logo abaixo, que abre o painel da
  // direita com todo mundo do app. Morou na titlebar até o mesmo dia.
  onMembersClick: () => void
  membersActive: boolean
  // Recarrega a lista de salas por HTTP, num caminho separado do
  // WebSocket de tempo real (ver useRooms.ts/rooms.ts) — é a rede de
  // segurança pra quando o tempo real está com problema. Veio da
  // sidebar antiga, que era onde este botão morava.
  refreshingRooms: boolean
  onRefreshRooms: () => void
  // O BOTÃO DE TRANSMITIR (um só desde 2026-10-22, pedido do usuário):
  // abre o seletor de fonte (Tela ou Vídeo, ver TransmitKindSwitch). Com
  // qualquer transmissão no ar ele SOME — quem controla é o rodapé.
  onOpenPicker: () => void
  // Chamado quando o ponteiro ENCOSTA no botão, antes de qualquer clique
  // (2026-10-13): quem recebe adianta o trabalho do seletor — ver
  // `onPrepareTransmission` em HomeScreen.tsx.
  onPrepareTransmission: () => void
  screenStatus: WebcamStatus
  webcamStatus: WebcamStatus
  onOpenSettings: () => void
  onUserUpdate: (user: AuthUser) => void
  onLogout: () => void
  // Abre a janela de perfil (2026-10-19). Repassado ao popover; quem
  // renderiza a janela é a HomeScreen, pelo mesmo motivo das
  // Configurações. Substituiu o `onNotify`, que só existia pro upload de
  // foto que o popover fazia.
  onOpenProfile: () => void
}

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
  incomingRequests,
  onMembersClick,
  membersActive,
  refreshingRooms,
  onRefreshRooms,
  onOpenPicker,
  onPrepareTransmission,
  screenStatus,
  webcamStatus,
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
      <Tooltip label="Lista de amigos" placement="right" delayMs={0}>
        <button
          type="button"
          className={`app-left-sidebar-live${usersActive ? ' app-left-sidebar-live-active' : ''}`}
          onClick={onUsersClick}
          aria-label={
            incomingRequests > 0
              ? `Lista de amigos — ${incomingRequests} pedido(s) de amizade`
              : 'Lista de amigos'
          }
        >
          <span className="app-left-sidebar-users-icon">
            <HeartHandshake size={20} />
          </span>
          {incomingRequests > 0 && (
            <span className="app-left-sidebar-badge" aria-hidden="true">
              {incomingRequests > 9 ? '9+' : incomingRequests}
            </span>
          )}
        </button>
      </Tooltip>

      {/* MEMBROS (2026-10-21, pedido do usuário) — logo abaixo da Lista de
          amigos, com o mesmo tile. Abre o painel da DIREITA. */}
      <Tooltip label="Membros" placement="right" delayMs={0}>
        <button
          type="button"
          className={`app-left-sidebar-live${membersActive ? ' app-left-sidebar-live-active' : ''}`}
          onClick={onMembersClick}
          aria-label="Membros"
          aria-pressed={membersActive}
        >
          <span className="app-left-sidebar-users-icon">
            <UserGroupIcon size={20} />
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

      {/* Rodapé: atualizar a lista e o perfil (o "entrar com código" saiu
          em 2026-10-21). O atualizar fica ACIMA do avatar porque o avatar é a âncora do
          popover de perfil — um irmão embaixo dele empurraria o cálculo
          de posição. */}
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

      {/* O BOTÃO DE TRANSMITIR — um só desde 2026-10-22 (pedido do
          usuário; eram dois, tela e webcam). Abre o seletor de fonte. Com
          a live no ar ele SOME (o rodapé é quem controla), e com ele o
          anel girando, a barrinha lateral e o card do hover que teve por
          um dia. */}
      {screenStatus === 'idle' && webcamStatus === 'idle' && (
        <Tooltip label="Transmitir" placement="right" delayMs={0}>
          <button
            type="button"
            className="app-left-sidebar-cast"
            onClick={onOpenPicker}
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
            {/* EU AO VIVO (2026-10-22, pedido do usuário): o mesmo selo AO VIVO
                dos tiles de sala, com a tela ou o vídeo no ar. */}
            {(screenStatus !== 'idle' || webcamStatus !== 'idle') && (
              <span className="app-left-sidebar-live-pill">LIVE</span>
            )}
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
