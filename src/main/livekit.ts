import { ipcMain } from 'electron'
import { API_BASE_URL, LIVEKIT_WS_URL } from './config'
import { authHeader } from './apiToken'
import { logEvent } from './debugLog'

export type ParticipantRole = 'host' | 'viewer'

export interface LivekitTokenParams {
  roomName: string
  participantName: string
  role: ParticipantRole
  // Item 15 do roadmap: grant "hidden" do LiveKit (participante não
  // conta em numParticipants nem aparece pra mais ninguém) — usado pelo
  // HOST pra entrar na própria sala como um segundo participante
  // (view-only) só pra receber de volta o próprio vídeo publicado
  // (preview). Default false (comportamento normal) se omitido.
  hidden?: boolean
  // Item novo (2026-09-04, "sala com senha"): só faz sentido pra
  // role 'viewer' — o server.js confere contra a senha da sala (ver
  // /token em server.js) antes de emitir o token, devolvendo 401 se
  // não bater.

}

export interface LivekitTokenResult {
  token: string
  wsUrl: string
}

interface TokenResponseBody {
  token: string
}

interface ApiErrorBody {
  error: string
}

// Roadmap item 45 — bug real corrigido (2026-09-03): `deleteRoom`/
// `deleteIngress` não tinham timeout nenhum — um `fetch()` sem resposta
// (rede fora do ar) podia ficar pendente por muito tempo (timeout de TCP
// do próprio SO, bem mais que isso). Isso importa especialmente no
// caminho de "app fechando" (ver stopForAppQuit em gstreamerCapture.ts),
// que tenta um número limitado de vezes antes de desistir — sem um
// timeout por tentativa, uma única chamada travada podia consumir sozinha
// todo o orçamento de tempo disponível.
const DELETE_REQUEST_TIMEOUT_MS = 5000

// Item 14 do roadmap: chamado quando o host para a transmissão de
// propósito — derruba a sala no LiveKit Server (RoomServiceClient no
// token-server), o que desconecta qualquer viewer ainda presente nela.
//
// Devolve se DEU CERTO DE VERDADE (2026-08-31: antes não devolvia nada,
// sempre otimista — bug real encontrado: uma falha silenciosa aqui
// deixava a sala viva no LiveKit sem o app nem o usuário saberem, ver
// ROADMAP.md item 18). Quem chama (useGstreamerTransmission.ts `stop()`)
// tenta de novo até isso devolver `true`.
export async function deleteRoom(roomName: string): Promise<boolean> {
  logEvent('livekit', `deleteRoom(${roomName}): enviando DELETE /rooms/${roomName}`)
  try {
    const response = await fetch(`${API_BASE_URL}/rooms/${roomName}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(DELETE_REQUEST_TIMEOUT_MS)
    })
    const data = (await response.json().catch(() => null)) as { ok?: boolean } | null
    const ok = response.ok && data?.ok === true
    logEvent(
      'livekit',
      `deleteRoom(${roomName}): ${ok ? 'sucesso' : 'FALHOU'} (HTTP ${response.status})`
    )
    return ok
  } catch (err) {
    logEvent('livekit', `deleteRoom(${roomName}): erro de rede/fetch: ${err}`)
    return false
  }
}

// Mesmo espírito do deleteRoom acima (devolve sucesso/falha real).
export async function deleteIngress(roomName: string): Promise<boolean> {
  logEvent('livekit', `deleteIngress(${roomName}): enviando DELETE /ingress/${roomName}`)
  try {
    const response = await fetch(`${API_BASE_URL}/ingress/${roomName}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(DELETE_REQUEST_TIMEOUT_MS)
    })
    const data = (await response.json().catch(() => null)) as { ok?: boolean } | null
    const ok = response.ok && data?.ok === true
    logEvent(
      'livekit',
      `deleteIngress(${roomName}): ${ok ? 'sucesso' : 'FALHOU'} (HTTP ${response.status})`
    )
    return ok
  } catch (err) {
    logEvent('livekit', `deleteIngress(${roomName}): erro de rede/fetch: ${err}`)
    return false
  }
}

export function setupLivekitHandlers(): void {
  ipcMain.handle(
    'livekit:getToken',
    async (_event, params: LivekitTokenParams): Promise<LivekitTokenResult> => {
      const query = new URLSearchParams({
        roomName: params.roomName,
        participantName: params.participantName,
        role: params.role,
        ...(params.hidden ? { hidden: 'true' } : {}),
        // A senha de sala saiu em 2026-09-10; sala privada agora é
        // decidida por convite, e o servidor confere isso sozinho em
        // /token (ver presence.isAllowedInRoom lá).
      }).toString()
      const response = await fetch(`${API_BASE_URL}/token?${query}`, {
        headers: { Authorization: authHeader() }
      })

      const data = (await response.json()) as TokenResponseBody | ApiErrorBody

      if (!response.ok) {
        throw new Error('error' in data ? data.error : 'Erro ao obter token do LiveKit')
      }

      return { token: (data as TokenResponseBody).token, wsUrl: LIVEKIT_WS_URL }
    }
  )

  ipcMain.handle('livekit:deleteRoom', (_event, roomName: string) => deleteRoom(roomName))

  // Item novo do roadmap ("Live via GStreamer"): cria um endpoint WHIP por
  // sala pro GStreamer publicar (encode de hardware, fora do Chromium).
  ipcMain.handle(
    'livekit:createIngress',
    async (
      _event,
      params: { roomName: string; participantName: string; private?: boolean }
    ): Promise<{ url: string; streamKey: string }> => {
      const response = await fetch(`${API_BASE_URL}/ingress`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      })

      const data = (await response.json()) as { url: string; streamKey: string } | ApiErrorBody

      if (!response.ok) {
        throw new Error('error' in data ? data.error : 'Erro ao criar ingress do LiveKit')
      }

      return data as { url: string; streamKey: string }
    }
  )

  ipcMain.handle('livekit:deleteIngress', (_event, roomName: string) => deleteIngress(roomName))
}
