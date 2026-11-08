import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomFeed, RoomInfo, roomSources } from './useRooms'
import { NewLiveAlerts } from './authUser'
import { playSound } from './sounds'

// Um card de "live nova" no canto superior direito do app — UM POR
// TRANSMISSÃO (2026-10-23, pedido do usuário): a tela e a webcam de uma
// mesma sala alertam cada uma a sua.
export interface NewLiveAlert {
  // `código:transmissão` — a chave do card.
  key: string
  code: string
  feed: RoomFeed
  hostName: string
}

const FEEDS: RoomFeed[] = ['screen', 'cam']

function alertKey(code: string, feed: RoomFeed): string {
  return `${code}:${feed}`
}

function activeFeeds(room: RoomInfo): RoomFeed[] {
  const sources = roomSources(room)
  return FEEDS.filter((feed) => sources[feed])
}

// Quantos cards cabem empilhados. O mais antigo sai quando chega o
// próximo — numa enxurrada (o servidor voltando com cinco lives), cinco
// cards cobririam a grade.
const MAX_ALERTS = 3

interface UseNewLiveAlertsResult {
  alerts: NewLiveAlert[]
  dismiss: (key: string) => void
}

// ALERTA DE LIVE NOVA (item 26, etapa 8 — 2026-10-22). Nasceu como
// useNewLiveSound (2026-09-06), que só tocava o som; o plano das
// notificações guardadas no banco e listadas num painel foi trocado pelo
// usuário no mesmo dia por isto: um ALERTA que não é guardado nem listado.
// Quando alguém INICIA uma live, conforme a preferência da conta:
//
//   - toca o newLive.mp3;
//   - acende o laranja do botão na barra de tarefas (só com o app sem
//     foco — quem filtra é o main, ver taskbarFlash.ts);
//   - mostra um card no canto superior direito (ver NewLiveAlertStack),
//     que some sozinho.
//
// A preferência (`mode`): Todas, Somente amigos ou Nenhuma — ver
// NewLiveAlerts em authUser.ts. "Todas" não precisa de filtro aqui: a
// privada de quem não é amigo nem chega na lista (o servidor filtra).
//
// A BASELINE (`knownRef`) é o ponto central: a primeira leitura da lista
// só REGISTRA quais salas já existem, sem alertar nada. Sem isso, abrir o
// app com cinco lives no ar dispararia cinco alertas de uma vez — e o
// mesmo aconteceria a cada reconexão do WebSocket de salas. Com o alerta
// desligado ela continua avançando: religar não pode fazer as salas que
// apareceram no meio alertarem juntas.
//
// A baseline só funciona se a Home NASCER com a lista de agora — ver o
// `load` em useRooms.ts (2026-10-19): o loading do login e o splash do
// "manter conectado" buscam a lista por HTTP antes de liberar a Home.
//
// A própria sala é ignorada: o som de iniciar a minha live é tocado pelos
// hooks de transmissão (resposta a um clique, não um alerta).
//
// POR TRANSMISSÃO (2026-10-23): a baseline guarda, por sala, quais
// transmissões já foram vistas. Uma sala no ar com a tela que liga a
// webcam alerta de novo — é uma live nova pra quem assiste. O "já vista"
// dura a vida da sala: o host trocando de fonte (a tela some e volta num
// instante) não repete o alerta.
export function useNewLiveAlerts(
  rooms: RoomInfo[],
  myRoomCode: string | null,
  mode: NewLiveAlerts,
  isFriend: (hostName: string) => boolean,
  // O meu nome (2026-10-28, item 27): a minha live pode estar saindo do
  // SITE, numa sala que este app não conhece pelo código — e ela não pode
  // me alertar "live nova" de mim mesmo.
  selfName?: string
): UseNewLiveAlertsResult {
  const [alerts, setAlerts] = useState<NewLiveAlert[]>([])
  // código da sala -> transmissões já vistas nela.
  const seenRef = useRef<Map<string, Set<RoomFeed>> | null>(null)
  // Transmissões que apareceram com a sala SEM host ainda (o nome chega
  // num broadcast seguinte). Sem o nome não dá pra saber se é de um amigo
  // — a decisão fica pra quando ele chegar, em vez de a transmissão virar
  // "vista" em silêncio e nunca alertar.
  const pendingRef = useRef<Set<string>>(new Set())

  // O `isFriend` muda a cada mudança de amizade; em ref pra não reavaliar
  // a lista de salas por causa disso (não é ele que diz o que é novo).
  const isFriendRef = useRef(isFriend)
  useEffect(() => {
    isFriendRef.current = isFriend
  }, [isFriend])

  useEffect(() => {
    // As transmissões no ar agora, por chave.
    const liveKeys = new Set<string>()
    for (const room of rooms) {
      for (const feed of activeFeeds(room)) liveKeys.add(alertKey(room.name, feed))
    }

    // Primeira observação: só baseline, em silêncio.
    if (!seenRef.current) {
      seenRef.current = new Map(rooms.map((room) => [room.name, new Set(activeFeeds(room))]))
      return
    }
    const seen = seenRef.current

    // Sala que acabou sai da baseline: se o mesmo código voltar, é outra
    // live.
    const currentCodes = new Set(rooms.map((room) => room.name))
    for (const code of seen.keys()) {
      if (!currentCodes.has(code)) seen.delete(code)
    }
    for (const key of pendingRef.current) {
      if (!liveKeys.has(key)) pendingRef.current.delete(key)
    }

    const fresh: NewLiveAlert[] = []
    for (const room of rooms) {
      const roomSeen = seen.get(room.name) ?? new Set<RoomFeed>()
      seen.set(room.name, roomSeen)
      for (const feed of activeFeeds(room)) {
        const key = alertKey(room.name, feed)
        if (roomSeen.has(feed) && !pendingRef.current.has(key)) continue
        roomSeen.add(feed)
        if (room.name === myRoomCode) continue
        if (!room.hostName) {
          pendingRef.current.add(key)
          continue
        }
        pendingRef.current.delete(key)
        if (room.hostName === selfName) continue
        if (mode === 'none') continue
        if (mode === 'friends' && !isFriendRef.current(room.hostName)) continue
        fresh.push({ key, code: room.name, feed, hostName: room.hostName })
      }
    }

    // Uma transmissão que acabou leva o card junto — "Assistir" numa live
    // que não existe mais seria um botão quebrado.
    setAlerts((current) => {
      const alive = current.filter((alert) => liveKeys.has(alert.key))
      if (fresh.length === 0) return alive.length === current.length ? current : alive
      const known = new Set(alive.map((alert) => alert.key))
      return [...alive, ...fresh.filter((alert) => !known.has(alert.key))].slice(-MAX_ALERTS)
    })

    if (fresh.length > 0) {
      // Um som e um destaque por leva, não um por sala.
      playSound('newLive')
      window.api.app.flashTaskbar()
    }
  }, [rooms, myRoomCode, mode, selfName])

  const dismiss = useCallback((key: string) => {
    setAlerts((current) => current.filter((alert) => alert.key !== key))
  }, [])

  return { alerts, dismiss }
}
