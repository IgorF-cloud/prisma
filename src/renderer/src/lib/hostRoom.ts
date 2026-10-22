// A SALA DO HOST (2026-10-20, item 26 do roadmap)
//
// Desde a webcam, a sala deixou de ser "a transmissão": ela é do host e
// recebe UMA ou DUAS transmissões — a da tela e a da webcam. Quem abre
// primeiro cria a sala (gera o código); a segunda se vincula a ela (usa o
// mesmo código). A sala só acaba quando a ÚLTIMA para.
//
// Este registro é o único lugar que sabe isso, e mora fora do React de
// propósito: as duas transmissões (useGstreamerTransmission e
// useWebcamTransmission) precisam consultá-lo e mudá-lo no MESMO instante
// em que decidem — um estado do React só refletiria a mudança no render
// seguinte. O caso que importa é parar as duas juntas (fechar o app): com
// estado, as duas veriam a outra ainda ativa, nenhuma derrubaria a sala,
// e ela ficaria órfã. Aqui a segunda a sair encontra o conjunto vazio, e
// é ela que derruba.

export type HostTransmission = 'screen' | 'cam'

let roomCode: string | null = null
let roomPrivate = false
const active = new Set<HostTransmission>()

function generateRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// Entra na sala do host — cria uma, se nenhuma transmissão estiver aberta.
// `attaching` diz se a sala já existia (a outra transmissão está no ar):
// aí a privacidade é a dela, e não a que quem chamou pediu.
export function claimHostRoom(
  kind: HostTransmission,
  wantPrivate: boolean
): { code: string; attaching: boolean; private: boolean } {
  const attaching = roomCode !== null
  if (!roomCode) {
    roomCode = generateRoomCode()
    roomPrivate = wantPrivate
  }
  active.add(kind)
  return { code: roomCode, attaching, private: roomPrivate }
}

// Sai da sala. `lastOne` diz se esta era a última transmissão — quem
// chamou é quem derruba a sala inteira; senão, só o próprio ingress.
export function releaseHostRoom(kind: HostTransmission): { lastOne: boolean } {
  if (!active.delete(kind)) return { lastOne: false }
  const lastOne = active.size === 0
  if (lastOne) {
    roomCode = null
    roomPrivate = false
  }
  return { lastOne }
}

// A sala aberta agora, se houver — e se ela é privada. É o que a janela
// de iniciar a outra transmissão usa pra mostrar a privacidade travada.
export function currentHostRoom(): { code: string; private: boolean } | null {
  return roomCode ? { code: roomCode, private: roomPrivate } : null
}

const TEARDOWN_MAX_ATTEMPTS = 10
const TEARDOWN_RETRY_MS = 2000

// Derruba UMA transmissão: o ingress dela e, se era a última, a sala.
// Mesmo teto de tentativas de antes (ver o comentário longo do
// teardownRoom em useGstreamerTransmission.ts — 20s aguentam qualquer
// tropeço de rede; o que passa disso não é tropeço).
//
// `true` se o servidor confirmou; `false` se desistiu no teto.
export async function teardownTransmission(
  code: string,
  kind: HostTransmission,
  alsoRoom: boolean
): Promise<boolean> {
  for (let attempt = 1; attempt <= TEARDOWN_MAX_ATTEMPTS; attempt++) {
    const ingressOk = await window.api.livekit.deleteIngress(code, kind)
    const roomOk = alsoRoom ? await window.api.livekit.deleteRoom(code) : true
    if (ingressOk && roomOk) return true

    if (attempt === TEARDOWN_MAX_ATTEMPTS) {
      console.warn(
        `[teardown] desistindo de derrubar "${kind}" da sala ${code} depois de ` +
          `${TEARDOWN_MAX_ATTEMPTS} tentativas (ingress=${ingressOk}, sala=${roomOk}).`
      )
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, TEARDOWN_RETRY_MS))
  }
  return false
}
