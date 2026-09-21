import { ipcMain } from 'electron'
import { API_BASE_URL } from './config'
import { authHeader, notifySessionExpired } from './apiToken'
import { AvatarRef, UserSettings } from './auth'

// Lista de usuários, presença e convites (2026-09-10) — item 11 do
// ROADMAP.
//
// Separado do auth.ts de propósito: aquele cuida da SUA conta (entrar,
// renomear, trocar senha); este cuida dos OUTROS (quem existe, quem está
// online, convidar pra uma live privada).

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
    throw new Error(
      (data as ApiErrorBody).error ?? 'Erro desconhecido ao falar com o servidor'
    )
  }

  return data as T
}

export function setupUsersHandlers(): void {
  // A lista vem do banco (todo mundo, inclusive offline). O estado
  // online/ocupado chega por fora, no broadcast de salas — ver
  // `presence` em rooms.ts. Aqui vem um retrato do momento só pra tela
  // não abrir vazia enquanto o primeiro broadcast não chega.
  ipcMain.handle('users:list', () =>
    request<{ users: DirectoryUser[]; presence: Partial<Record<number, 'online' | 'busy'>> }>(
      'GET',
      '/users'
    )
  )

  // Só "available" ou "busy": offline não é escolha, é consequência de
  // fechar o app (o servidor deriva isso do WebSocket).
  ipcMain.handle('users:setPresence', (_event, id: number, preference: 'available' | 'busy') =>
    request<DirectoryUser>('PUT', `/users/${id}/presence`, { preference })
  )

  // Convidar alguém pra uma live privada. Falha com 409 se a pessoa
  // saiu do ar entre a tela listar e o clique acontecer.
  ipcMain.handle('users:invite', (_event, roomName: string, userId: number) =>
    request<void>('POST', `/rooms/${roomName}/invite`, { userId })
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

  // Aceitar. A partir daqui o servidor passa a mandar essa sala nos
  // broadcasts pra este usuário, e o /token deixa ele entrar.
  ipcMain.handle('users:acceptInvite', (_event, roomName: string) =>
    request<void>('POST', `/rooms/${roomName}/invite/accept`)
  )

  // Recusar (2026-09-14). Não muda permissão nenhuma — quem não
  // aceitou nunca entrou na lista —, serve pra AVISAR o host: é o que
  // destrava o botão de convidar do lado dele.
  //
  // `reason` separa o "não quero" do "não vi": o host vê textos
  // diferentes, porque as duas coisas dizem coisas diferentes.
  ipcMain.handle(
    'users:declineInvite',
    (_event, roomName: string, reason: 'declined' | 'expired') =>
      request<void>('POST', `/rooms/${roomName}/invite/decline`, { reason })
  )
}
