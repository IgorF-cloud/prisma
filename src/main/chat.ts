import { ipcMain } from 'electron'
import { API_BASE_URL } from './config'
import { authHeader, notifySessionExpired } from './apiToken'

// Chat temporário da live (2026-09-23) — item novo do ROADMAP.
//
// Só o lado de MANDAR mora aqui. O de RECEBER está em rooms.ts, porque
// as mensagens descem pelo WebSocket `/ws/rooms` que já existe — é o
// mesmo desenho do convite (POST pra agir, WebSocket pra ser avisado),
// e o WebSocket nunca leu nada do cliente.
//
// POR QUE NÃO PELO DATA CHANNEL DO LIVEKIT, que seria o caminho
// "natural": o HOST não está na sala. Ele publica via GStreamer/WHIP,
// então quem representa ele no LiveKit é o Ingress — criado pelo
// servidor, e só de mídia. O app do host só abre uma `Room` do
// livekit-client quando o preview é ligado (ver useHostPreview.ts).
// Pelo data channel, o chat exigiria uma conexão LiveKit nova e
// PERMANENTE no host, que é justamente a classe de bug que o
// `NEVER_RECONNECT` de useHostPreview.ts existe pra conter (conexão
// sobrevivente ressuscitando uma sala já apagada, via `auto_create` do
// LiveKit). O WebSocket, por outro lado, já está aberto e autenticado
// pra todo mundo — host incluído — durante a sessão inteira.

export interface ChatMessage {
  // `${epochMs}-${seq}` gerado pelo servidor. Serve de key de lista no
  // React — por isso precisa do desempate: duas mensagens no mesmo
  // milissegundo repetiriam o timestamp sozinho.
  id: string
  // Nome de quem falou, no momento em que falou. O servidor resolve
  // isso pelo ID do usuário (não pelo nome no JWT, que fica velho depois
  // de uma renomeação — ver chat.js no prisma_server).
  from: string
  text: string
  at: number
}

interface ApiErrorBody {
  error: string
}

const REQUEST_TIMEOUT_MS = 10000

// Mesma função de users.ts. Duplicada seguindo o padrão já existente no
// projeto (auth.ts e users.ts também têm a sua) — em vez de um módulo
// "http" compartilhado, que seria a quarta abstração pra três chamadas.
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

export function setupChatHandlers(): void {
  // Mandar uma mensagem. Responde 204 e NÃO devolve a mensagem: ela
  // volta pelo WebSocket junto com a de todo mundo (o servidor ecoa pro
  // próprio autor de propósito). Assim não existe update otimista nem
  // deduplicação no app — a mensagem só aparece depois de aceita.
  //
  // O erro sobe pra quem chamou: 403 quando a pessoa foi silenciada ou
  // já não está na sala, 429 quando mandou rápido demais.
  ipcMain.handle('chat:send', (_event, roomName: string, text: string) =>
    request<void>('POST', `/rooms/${roomName}/chat`, { text })
  )

  // O que já foi dito nesta live — pedido uma vez, ao entrar na sala.
  // Sem isso, quem chega no meio de uma live de duas horas vê um chat
  // vazio. O servidor guarda só as últimas mensagens, em memória, e
  // joga tudo fora quando a sala acaba.
  //
  // `mutedNames` é quem o host silenciou, por nome, e vem pra TODO MUNDO
  // da sala (2026-09-23) — não só pro host. É o que desenha o selo de
  // silenciado na lista de espectadores das duas telas, e também o que
  // responde "EU estou silenciado aqui?" (comparando com o próprio
  // nome), pro campo de texto já nascer desabilitado em vez de deixar
  // escrever e tomar 403.
  ipcMain.handle('chat:history', (_event, roomName: string) =>
    request<{ messages: ChatMessage[]; mutedNames: string[] }>('GET', `/rooms/${roomName}/chat`)
  )

  // Silenciar/liberar alguém na MINHA live. Por nome, e não por id, pelo
  // mesmo motivo do `users:kick`: a lista de quem está assistindo é uma
  // lista de identities do LiveKit, que aqui são os nomes de usuário — o
  // id nem passa por essa tela. O servidor resolve o id quando precisa.
  //
  // Quem é o host é decidido lá, não aqui: a rota recusa com 403 quem
  // não for o dono da sala.
  ipcMain.handle('chat:mute', (_event, roomName: string, username: string, muted: boolean) =>
    request<void>('POST', `/rooms/${roomName}/chat/mute`, { username, muted })
  )
}
