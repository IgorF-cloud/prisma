import { useEffect, useState } from 'react'
import { getErrorMessage } from './errors'
import { AvatarRef } from './avatar'
import { NowPlayingInfo } from './nowPlaying'

export interface RoomInfo {
  name: string
  hostName: string | null
  // Quem está na sala agora (inclui o host) — quantidade de espectadores é
  // participants.length descontando o host, não um campo separado (ver
  // comentário em src/main/rooms.ts sobre por que numParticipants foi
  // removido).
  participants: string[]
  // Item 29 do roadmap: jogo (Steam ou lista do Discord) ou título da
  // janela sendo transmitida pelo host — null quando nada foi
  // detectado/reportado ainda.
  game: NowPlayingInfo | null
  // Item 42 do roadmap: quando a sala começou de verdade (epoch ms) — vem
  // do `creationTimeMs` do próprio LiveKit (ver server.js), não do
  // relógio de nenhuma máquina cliente. Base do timer de duração da live.
  startedAt: number
  // Item novo (2026-09-04, "sala com senha"): só a existência de uma
  // senha, NUNCA a senha em si (ver toPublicRoom em server.js) — usado
  // pra mostrar o cadeado no tile e decidir se abre o modal pedindo
  // senha antes de entrar.
  // Substituiu o `hasPassword` em 2026-09-10: a senha de sala saiu e no
  // lugar entrou o checkbox "Transmissão privada". Sala privada não
  // aparece nesta lista pra quem não foi convidado — o servidor filtra
  // antes de mandar, então receber uma aqui já significa que dá pra
  // entrar.
  private: boolean
  // Quais transmissões a sala tem (2026-10-20, webcam — item 26): a da
  // TELA e/ou a da WEBCAM, cada uma com o seu tile pra quem assiste.
  // Opcional porque servidor anterior à 1.2 não manda — ver `roomSources`.
  sources?: RoomSources
  // Quando cada transmissão começou (epoch ms, 2026-10-23) — o timer de
  // cada tile na ficha da sala. Opcional: servidor anterior não manda, e
  // aí vale o `startedAt` da sala (ver `feedStartedAt`).
  sourcesStartedAt?: Partial<Record<RoomFeed, number | null>>
  // De onde vem cada transmissão (2026-10-28, item 27): "app" (este app)
  // ou "web" (o Prisma Web). `null` na que não está no ar ou cuja origem
  // o servidor não sabe. Opcional: servidor anterior não manda.
  origins?: Partial<Record<RoomFeed, 'app' | 'web' | null>>
}

export interface RoomSources {
  screen: boolean
  cam: boolean
}

export type RoomFeed = keyof RoomSources

// O início de UMA transmissão, com o da sala quando o servidor não diz.
export function feedStartedAt(room: RoomInfo, feed: RoomFeed): number {
  return room.sourcesStartedAt?.[feed] ?? room.startedAt
}

// As transmissões de uma sala, com o padrão de antes da webcam (só tela)
// quando o servidor não diz nada.
export function roomSources(room: RoomInfo | undefined): RoomSources {
  return room?.sources ?? { screen: true, cam: false }
}

// As transmissões que a sala NÃO tem agora (2026-10-20). Entrar numa
// sala já com elas fechadas é o que impede uma transmissão que o host
// liga depois de abrir sozinha pra quem já está assistindo — ela aparece
// na ficha da sala e só abre no "Assistir".
//
// Sala desconhecida (convite aceito: privada, ela só chega na lista
// depois do aceite) não fecha nada — sem saber o que ela transmite,
// fechar "a webcam" poderia fechar justamente a única transmissão dela.
export function absentFeeds(room: RoomInfo | undefined): RoomFeed[] {
  if (!room) return []
  const sources = roomSources(room)
  return (['screen', 'cam'] as RoomFeed[]).filter((feed) => !sources[feed])
}

// userId -> estado. Quem NAO esta no mapa esta offline. Vem junto das
// salas porque muda pelos mesmos eventos (conectar/desconectar).
// `Partial` não é decorativo: quem está offline NÃO aparece no mapa, e
// sem ele o TypeScript trata todo acesso como se sempre houvesse valor —
// aí o `?? 'offline'` de quem lê vira código morto pra ele, e comparar o
// resultado com 'offline' vira erro de tipo.
export type PresenceMap = Partial<Record<number, 'online' | 'busy'>>

interface UseRoomsResult {
  rooms: RoomInfo[]
  // Item 43 do roadmap: diretório nome -> avatar, recalculado do zero
  // pelo token-server a cada broadcast (ver buildUserAvatarsDirectory em
  // server.js) — chega junto de toda atualização de `rooms`, nunca por
  // sala (avatar é do usuário, não da sala).
  userAvatars: Record<string, AvatarRef>
  presence: PresenceMap
  // Item novo (2026-08-31): botão "atualizar lista" — pede a lista de
  // novo via HTTP (ver rooms:refresh, src/main/rooms.ts), sem depender
  // da conexão em tempo real. `refreshing` só controla o spinner do
  // botão; o próprio `rooms` já atualiza sozinho via onUpdate quando o
  // main process manda o resultado.
  refreshing: boolean
  refresh: () => Promise<void>
  // Busca a lista por HTTP e já põe no estado, RESOLVENDO só depois
  // disso (2026-10-19). Chamado dentro do loading do login e do splash
  // do "manter conectado", pra a Home nascer com as salas de agora —
  // ver o porquê em useNewLiveSound.ts. Nunca rejeita: sem servidor, a
  // Home abre e a lista chega pelo WebSocket quando der.
  load: () => Promise<void>
}

// Item 19 do roadmap: lista de salas em tempo real via webhook do LiveKit
// (ver src/main/rooms.ts, que mantém a conexão WebSocket de verdade — o
// renderer só recebe o que já chega pronto via IPC).
export function useRooms(onRefreshError?: (message: string) => void): UseRoomsResult {
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [userAvatars, setUserAvatars] = useState<Record<string, AvatarRef>>({})
  const [presence, setPresence] = useState<PresenceMap>({})
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    window.api.rooms.list().then((snapshot) => {
      setRooms(snapshot.rooms)
      setUserAvatars(snapshot.userAvatars)
      setPresence(snapshot.presence ?? {})
    })
    return window.api.rooms.onUpdate((snapshot) => {
      setRooms(snapshot.rooms)
      setUserAvatars(snapshot.userAvatars)
      setPresence(snapshot.presence ?? {})
    })
  }, [])

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      await window.api.rooms.refresh()
    } catch (err) {
      onRefreshError?.(getErrorMessage(err, 'Não foi possível atualizar a lista de salas'))
    } finally {
      setRefreshing(false)
    }
  }

  async function load(): Promise<void> {
    try {
      // `refresh` devolve o retrato, e ele é aplicado AQUI em vez de
      // esperar o evento `rooms:update` que o main também manda: assim
      // o estado já está certo quando o `await` de quem chamou termina.
      const snapshot = await window.api.rooms.refresh()
      setRooms(snapshot.rooms)
      setUserAvatars(snapshot.userAvatars)
      setPresence(snapshot.presence ?? {})
    } catch {
      // Sem servidor: segue com o que houver.
    }
  }

  return { rooms, userAvatars, presence, refreshing, refresh, load }
}
