import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomInfo } from './useRooms'
import { NewLiveAlerts } from './authUser'
import { playSound } from './sounds'

// Um card de "live nova" no canto superior direito do app.
export interface NewLiveAlert {
  // O código da sala — também a chave do card.
  code: string
  hostName: string
}

// Quantos cards cabem empilhados. O mais antigo sai quando chega o
// próximo — numa enxurrada (o servidor voltando com cinco lives), cinco
// cards cobririam a grade.
const MAX_ALERTS = 3

interface UseNewLiveAlertsResult {
  alerts: NewLiveAlert[]
  dismiss: (code: string) => void
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
export function useNewLiveAlerts(
  rooms: RoomInfo[],
  myRoomCode: string | null,
  mode: NewLiveAlerts,
  isFriend: (hostName: string) => boolean
): UseNewLiveAlertsResult {
  const [alerts, setAlerts] = useState<NewLiveAlert[]>([])
  const knownRef = useRef<Set<string> | null>(null)
  // Salas que apareceram SEM host ainda (o nome chega num broadcast
  // seguinte). Sem o nome não dá pra saber se é de um amigo — a decisão
  // fica pra quando ele chegar, em vez de a sala virar "conhecida" em
  // silêncio e nunca alertar.
  const pendingRef = useRef<Set<string>>(new Set())

  // O `isFriend` muda a cada mudança de amizade; em ref pra não reavaliar
  // a lista de salas por causa disso (não é ele que diz o que é novo).
  const isFriendRef = useRef(isFriend)
  useEffect(() => {
    isFriendRef.current = isFriend
  }, [isFriend])

  useEffect(() => {
    const currentCodes = new Set(rooms.map((room) => room.name))
    const previousCodes = knownRef.current
    knownRef.current = currentCodes

    // Primeira observação: só baseline, em silêncio.
    if (!previousCodes) return

    for (const code of pendingRef.current) {
      if (!currentCodes.has(code)) pendingRef.current.delete(code)
    }

    const fresh: NewLiveAlert[] = []
    for (const room of rooms) {
      if (room.name === myRoomCode) continue
      const isNew = !previousCodes.has(room.name) || pendingRef.current.has(room.name)
      if (!isNew) continue
      if (!room.hostName) {
        pendingRef.current.add(room.name)
        continue
      }
      pendingRef.current.delete(room.name)
      if (mode === 'none') continue
      if (mode === 'friends' && !isFriendRef.current(room.hostName)) continue
      fresh.push({ code: room.name, hostName: room.hostName })
    }

    // Uma sala que acabou leva o card junto — "Assistir" numa live que
    // não existe mais seria um botão quebrado.
    setAlerts((current) => {
      const alive = current.filter((alert) => currentCodes.has(alert.code))
      if (fresh.length === 0) return alive.length === current.length ? current : alive
      const known = new Set(alive.map((alert) => alert.code))
      return [...alive, ...fresh.filter((alert) => !known.has(alert.code))].slice(-MAX_ALERTS)
    })

    if (fresh.length > 0) {
      // Um som e um destaque por leva, não um por sala.
      playSound('newLive')
      window.api.app.flashTaskbar()
    }
  }, [rooms, myRoomCode, mode])

  const dismiss = useCallback((code: string) => {
    setAlerts((current) => current.filter((alert) => alert.code !== code))
  }, [])

  return { alerts, dismiss }
}
