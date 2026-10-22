import { ipcMain } from 'electron'
import { API_BASE_URL } from './config'
import { authHeader, notifySessionExpired } from './apiToken'
import { AvatarRef, UserSettings } from './auth'

// Lista de usuários, presença e amizades (2026-09-10) — item 11 do
// ROADMAP. O convite saiu em 2026-10-21 (item 26, etapa 5): a sala
// privada passou a ser do dono e dos amigos dele.
//
// Separado do auth.ts de propósito: aquele cuida da SUA conta (entrar,
// renomear, trocar senha); este cuida dos OUTROS (quem existe, quem está
// online, quem é amigo).

// As minhas relações, em três listas de ids (ver friends.js no
// servidor): amigos, pedidos que recebi e pedidos que mandei.
export interface FriendsSnapshot {
  friends: number[]
  incoming: number[]
  outgoing: number[]
}

export interface DirectoryUser {
  id: number
  name: string
  avatar: AvatarRef | null
  settings: UserSettings
  // Preferência salva do próprio usuário. Não confundir com o estado:
  // "available" só vira "online" de verdade se ele estiver conectado.
  presence: 'available' | 'busy'
}

interface ApiErrorBody {
  error: string
}

const REQUEST_TIMEOUT_MS = 10000

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader()
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error('O servidor demorou demais para responder. Tente novamente.')
    }
    throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.')
  }

  if (response.status === 204) return undefined as T

  let data: T | ApiErrorBody
  try {
    data = (await response.json()) as T | ApiErrorBody
  } catch {
    throw new Error('O servidor respondeu de forma inesperada.')
  }

  if (!response.ok) {
    if (response.status === 401) notifySessionExpired()
    throw new Error((data as ApiErrorBody).error ?? 'Erro desconhecido ao falar com o servidor')
  }

  return data as T
}

export function setupUsersHandlers(): void {
  // A lista vem do banco (todo mundo, inclusive offline). O estado
  // online/ocupado chega por fora, no broadcast de salas — ver
  // `presence` em rooms.ts. Aqui vem um retrato do momento só pra tela
  // não abrir vazia enquanto o primeiro broadcast não chega.
  ipcMain.handle('users:list', () =>
    request<{
      users: DirectoryUser[]
      presence: Partial<Record<number, 'online' | 'busy'>>
      // Os ids que EU fixei (2026-09-25). Vem junto da lista, e não numa
      // rota própria, porque quem abre a lista precisa sempre dos dois —
      // duas chamadas dariam um instante com a ordem errada na tela.
      pinned: number[]
    }>('GET', '/users')
  )

  // Só "available" ou "busy": offline não é escolha, é consequência de
  // fechar o app (o servidor deriva isso do WebSocket).
  ipcMain.handle('users:setPresence', (_event, id: number, preference: 'available' | 'busy') =>
    request<DirectoryUser>('PUT', `/users/${id}/presence`, { preference })
  )

  // Fixar / desfixar alguém no topo da MINHA lista (2026-09-25).
  //
  // Sem `id` de quem fixa: o dono é sempre quem está autenticado, e o
  // servidor tira isso do token. Mandar daqui só criaria um campo que
  // ele teria que ignorar — ou, pior, confiar.
  //
  // As duas rotas são idempotentes do lado de lá: fixar duas vezes não
  // é erro, e desfixar quem não estava fixado responde 204 igual. É o
  // que deixa a tela atualizar no clique (otimista) sem precisar
  // sincronizar nada depois.
  ipcMain.handle('users:pin', (_event, id: number) => request<void>('POST', `/users/${id}/pin`))

  ipcMain.handle('users:unpin', (_event, id: number) => request<void>('DELETE', `/users/${id}/pin`))

  // Amizades (2026-10-21). Toda rota devolve o RETRATO das minhas
  // relações depois da mudança (o mesmo que desce pelo WebSocket como
  // type "friends"), então a tela atualiza com a resposta, sem esperar
  // o aviso. O id é sempre o da OUTRA pessoa.
  ipcMain.handle('users:friends', () => request<FriendsSnapshot>('GET', '/friends'))
  ipcMain.handle('users:requestFriend', (_event, id: number) =>
    request<FriendsSnapshot>('POST', `/friends/${id}/request`)
  )
  ipcMain.handle('users:acceptFriend', (_event, id: number) =>
    request<FriendsSnapshot>('POST', `/friends/${id}/accept`)
  )
  // Recusar, cancelar o pedido ou desfazer a amizade — a mesma rota.
  ipcMain.handle('users:removeFriend', (_event, id: number) =>
    request<FriendsSnapshot>('DELETE', `/friends/${id}`)
  )

  // Expulsar alguém da MINHA live (2026-09-13). Por NOME e não por
  // id: a lista de quem está assistindo é uma lista de identities do
  // LiveKit, que aqui são os nomes de usuário — o id nem passa por
  // esta tela. O servidor resolve o id quando precisa dele (pra tirar
  // da lista de permissão de uma sala privada).
  //
  // Quem é o host é decidido lá, não aqui: o botão só aparece na
  // minha própria live, mas isso é conveniência de interface, e a
  // rota recusa com 403 quem não for o dono da sala.
  ipcMain.handle('users:kick', (_event, roomName: string, username: string) =>
    request<void>('POST', `/rooms/${roomName}/kick`, { username })
  )

  // "Saí desta live" (2026-10-20): tira o meu nome da lista de quem está
  // assistindo NA HORA, sem esperar o webhook do LiveKit (3-4s). Servidor
  // anterior a isto responde 404 — quem chama ignora o erro.
  ipcMain.handle('users:leaveRoom', (_event, roomName: string) =>
    request<void>('POST', `/rooms/${roomName}/leave`)
  )
}
