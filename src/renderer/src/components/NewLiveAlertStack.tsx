import { useEffect, useRef, useState } from 'react'
import { Eye, Lock, Play, Radio, X } from 'lucide-react'
import { AvatarRef, customAvatarUrl } from '../lib/avatar'
import { RoomInfo } from '../lib/useRooms'
import { NewLiveAlert } from '../lib/useNewLiveAlerts'
import UserAvatar from './UserAvatar'
import NowPlayingArt from './NowPlayingArt'

// Quanto um card fica na tela. Parado com o mouse em cima (a pessoa está
// lendo ou indo clicar), e a barrinha embaixo mostra o que falta.
const LIFETIME_MS = 9000
// A animação de saída (ver `.live-alert-leaving` no CSS).
const EXIT_MS = 220

interface NewLiveAlertStackProps {
  alerts: NewLiveAlert[]
  rooms: RoomInfo[]
  userAvatars: Record<string, AvatarRef>
  apiBaseUrl: string
  onWatch: (room: RoomInfo) => void
  onDetails: (code: string) => void
  onDismiss: (code: string) => void
}

// Os cards de LIVE NOVA (item 26, etapa 8 — 2026-10-22), no canto superior
// direito do app, logo abaixo da titlebar. Não são guardados nem listados:
// somem sozinhos, no X, ou quando a live acaba (ver useNewLiveAlerts).
//
// Os dados da sala são lidos da lista de AGORA, e não guardados no
// alerta: o jogo costuma chegar um instante depois de a sala aparecer, e o
// card acompanha.
function NewLiveAlertStack({
  alerts,
  rooms,
  userAvatars,
  apiBaseUrl,
  onWatch,
  onDetails,
  onDismiss
}: NewLiveAlertStackProps): React.JSX.Element | null {
  if (alerts.length === 0) return null
  return (
    <div className="live-alert-stack" role="region" aria-label="Lives novas">
      {alerts.map((alert) => {
        const room = rooms.find((r) => r.name === alert.code)
        if (!room) return null
        return (
          <NewLiveAlertCard
            key={alert.code}
            room={room}
            hostName={alert.hostName}
            avatar={userAvatars[alert.hostName] ?? null}
            apiBaseUrl={apiBaseUrl}
            onWatch={() => onWatch(room)}
            onDetails={() => onDetails(room.name)}
            onDismiss={() => onDismiss(alert.code)}
          />
        )
      })}
    </div>
  )
}

interface NewLiveAlertCardProps {
  room: RoomInfo
  hostName: string
  avatar: AvatarRef | null
  apiBaseUrl: string
  onWatch: () => void
  onDetails: () => void
  onDismiss: () => void
}

function NewLiveAlertCard({
  room,
  hostName,
  avatar,
  apiBaseUrl,
  onWatch,
  onDetails,
  onDismiss
}: NewLiveAlertCardProps): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // O tempo que FALTA, descontado a cada pausa — o timer recomeça do que
  // sobrou, não do zero.
  const remainingRef = useRef(LIFETIME_MS)
  const startedRef = useRef(0)

  useEffect(() => {
    if (paused || leaving) return
    startedRef.current = Date.now()
    const timer = setTimeout(() => setLeaving(true), remainingRef.current)
    return () => {
      clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current))
    }
  }, [paused, leaving])

  // Em ref: quem chama passa uma função nova a cada render (e a Home
  // renderiza a cada broadcast de salas), o que reiniciaria a saída.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => onDismissRef.current(), EXIT_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  const photo = avatar?.type === 'custom' ? customAvatarUrl(apiBaseUrl, avatar) : null
  const viewers = room.participants.filter((p) => p !== room.hostName).length

  return (
    <div
      className={`live-alert${leaving ? ' live-alert-leaving' : ''}`}
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* A foto da pessoa borrada no fundo, como a capa do mini perfil. */}
      {photo && <img className="live-alert-backdrop" src={photo} alt="" />}

      <button
        type="button"
        className="live-alert-close"
        onClick={() => setLeaving(true)}
        aria-label="Fechar alerta"
      >
        <X size={13} />
      </button>

      <button type="button" className="live-alert-main" onClick={onDetails}>
        <span className="live-alert-avatar">
          <UserAvatar avatar={avatar} apiBaseUrl={apiBaseUrl} size={22} />
        </span>
        <span className="live-alert-text">
          <span className="live-alert-eyebrow">
            <span className="live-alert-dot" aria-hidden="true" />
            Ao vivo agora
            {room.private && (
              <span className="live-alert-private">
                <Lock size={9} />
                Privada
              </span>
            )}
          </span>
          <span className="live-alert-title">
            <strong>{hostName}</strong> iniciou uma live
          </span>
        </span>
      </button>

      <div className="live-alert-footer">
        <span className="live-alert-game">
          {room.game ? (
            <NowPlayingArt info={room.game} />
          ) : (
            <span className="live-alert-game-icon">
              <Radio size={13} />
            </span>
          )}
          <span className="live-alert-game-text">
            <span className="live-alert-game-name" title={room.game?.name}>
              {room.game?.name ?? 'Sala aberta'}
            </span>
            {viewers > 0 && (
              <span className="live-alert-viewers">
                <Eye size={10} />
                {viewers} assistindo
              </span>
            )}
          </span>
        </span>
        <button
          type="button"
          className="live-alert-watch"
          onClick={() => {
            onWatch()
            setLeaving(true)
          }}
        >
          <Play size={12} fill="currentColor" />
          Assistir
        </button>
      </div>

      <span
        className={`live-alert-progress${paused ? ' live-alert-progress-paused' : ''}`}
        style={{ animationDuration: `${LIFETIME_MS}ms` }}
        aria-hidden="true"
      />
    </div>
  )
}

export default NewLiveAlertStack
