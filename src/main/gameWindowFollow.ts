import { BrowserWindow } from 'electron'
import { findGameByProcessName } from './gameDetectableCache'
import { listWindows, WindowInfo } from './nativeCaptureTargets'
import { logGstreamer } from './gstreamerLog'
import { WINDOW_HANDLE_PREFIX } from './screenCapture'

// Item 13 do roadmap — troca automática de janela. Pedido do usuário
// (2026-09-10). O caso que motivou:
// o League of Legends abre o CLIENTE numa janela e a PARTIDA em outra.
// Quem transmite "a janela do LoL" escolhe o cliente (é o que está aberto
// na hora), e quando a partida começa os viewers ficam olhando pro
// cliente minimizado.
//
// A implementação é GENÉRICA de propósito, sem uma linha sequer sobre o
// LoL. O que torna isso possível já estava no app: a lista de jogos
// detectáveis do Discord (ver gameDetectableCache.ts) agrupa o cliente e
// o jogo NA MESMA ENTRADA —
//
//   {"name":"League of Legends","executables":[
//      "leagueclientux.exe",       <- o cliente
//      "league of legends.exe",    <- o jogo
//      ...]}
//
// — então "essas duas janelas são o mesmo jogo" é uma pergunta que a
// lista já responde, e responde pros ~10.449 jogos dela, não só pro LoL.
// Qualquer launcher que abra o jogo num processo separado ganha isso de
// graça.
//
// ---------------------------------------------------------------------
// POR QUE UMA MÁQUINA DE ESTADOS, E NÃO UM DEBOUNCE
//
// O reflexo diante de "pode ficar trocando" é pôr um timer. Aqui ele
// seria a ferramenta errada: o cliente do LoL NÃO fecha quando a partida
// começa (ele minimiza e volta no fim), então as duas janelas convivem a
// partida inteira. O risco nunca foi "janela pisca rápido" — foi
// "reavaliar qual é a melhor janela a cada tick, pra sempre". Um timer só
// atrasaria a oscilação.
//
// O que resolve é histerese. Dois estados, e o segundo NÃO faz a
// pergunta:
//
//   ORIGINAL -> a cada tick: existe outra janela do mesmo jogo?
//               achou -> troca, vai pra AUTO
//   AUTO     -> a cada tick: o HWND que eu escolhi ainda existe?
//               sumiu -> volta pro ORIGINAL (ou deixa a live cair)
//
// Em AUTO a pergunta "qual é a melhor janela" nunca mais é feita. Não há
// empate, não há "mais recente ganha" recorrente, não há oscilação: a
// troca acontece uma vez por partida em cada sentido. E só existe UM
// nível — de AUTO nunca se pula pra uma terceira janela.
// ---------------------------------------------------------------------

// Mais curto que o polling de jogo (8s, ver gameDetection.ts) porque
// aqui a latência é visível pro viewer: é o tempo que ele passa olhando
// pro cliente depois da partida já ter começado. Cada olhada é uma
// enumeração de janelas (~85ms no helper nativo), a 4s isso é ruído.
const TICK_MS = 4000

// Só na VOLTA. O fim de partida do LoL fecha a janela do jogo em etapas,
// e sem isso um resquício reaparecendo faria a gente pular pra frente de
// novo no mesmo segundo. Custa nada: a próxima partida está a minutos de
// distância.
const RETURN_COOLDOWN_MS = 30_000

// Se o `update()` que a gente pediu não voltar nesse prazo, alguma coisa
// deu errado (a fonte nova falhou ao resolver, o renderer não estava
// ouvindo). Nesse caso o seguidor se desliga pra esta live inteira, em
// vez de insistir: o estado dele não bate mais com o que o pipeline está
// capturando de verdade, e continuar palpitando a partir de um estado
// errado é pior do que não fazer nada.
const PENDING_TIMEOUT_MS = 15_000

interface FollowState {
  // Identidade da ENTRADA da lista do Discord, por nome. Não dá pra usar
  // igualdade de referência: `getExeToGameMap()` monta um objeto
  // `DetectedGame` novo pra cada executável, mesmo os do mesmo jogo.
  gameName: string
  // A janela que o USUÁRIO escolheu. Guardada por HWND (e não pelo
  // sourceId original, que aponta por título) porque é pra ela que a
  // volta acontece, e a volta tem exatamente o mesmo problema de empate
  // de título que a ida.
  originalHandle: string
  originalPid: number
  // Preenchido só enquanto o app está capturando a janela irmã.
  autoHandle: string | null
  cooldownUntil: number
  // Troca pedida ao renderer e ainda não confirmada. Segura o tick pra
  // não pedir uma segunda troca por cima da primeira.
  pending: { sourceId: string; since: number } | null
  // `tryRecoverFromExit` está no ar procurando pra onde voltar
  // (2026-09-20).
  //
  // Segura o tick pelo mesmo motivo do `pending`, mas numa janela de
  // tempo que passou a existir agora: a recuperação deixou de ser
  // instantânea (ela insiste por alguns segundos, ver
  // RECOVERY_LOOKUP_ATTEMPTS) e um tick cai bem no meio dela — os dois
  // olham pro mesmo estado e chegariam à mesma conclusão em dobro.
  // Pior: o caminho do tick DESISTE quando não acha a janela original
  // (`stopFollowing`), que é justamente o que a recuperação está
  // esperando aparecer. O tick derrubaria a live que ela ia salvar.
  //
  // Enquanto isto está ligado não há processo nenhum capturando, então
  // não existe decisão útil pro tick tomar de qualquer forma.
  recovering: boolean
}

let state: FollowState | null = null
let timer: ReturnType<typeof setInterval> | null = null

function clearTimer(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function stopFollowing(): void {
  clearTimer()
  state = null
}

function handleOf(window: WindowInfo): string {
  return String(window.Handle)
}

function requestSwitch(mainWindow: BrowserWindow, handle: string): void {
  if (!state) return
  const sourceId = `${WINDOW_HANDLE_PREFIX}${handle}`
  state.pending = { sourceId, since: Date.now() }
  logGstreamer(`gameWindowFollow: pedindo troca pra ${sourceId}`)
  // Passa pelo RENDERER de propósito, em vez de reiniciar o pipeline
  // daqui direto: o `update()` do useGstreamerTransmission é quem
  // reaproveita o whipUrl/streamKey (a sala não é recriada) E quem
  // guarda o `settings.sourceId` que o modal de troca de fonte exibe.
  // Reiniciando por fora, a sala sobreviveria igual, mas a UI passaria o
  // resto da live mostrando a janela errada como fonte atual.
  mainWindow.webContents.send('gstreamer:autoSourceChanged', { sourceId })
}

async function tick(mainWindow: BrowserWindow): Promise<void> {
  if (!state) return
  // Recuperação em andamento é dona do estado até terminar — ver
  // `recovering` na FollowState.
  if (state.recovering) return

  if (state.pending) {
    if (Date.now() - state.pending.since < PENDING_TIMEOUT_MS) return
    logGstreamer(
      `gameWindowFollow: troca pra ${state.pending.sourceId} não foi confirmada em ` +
        `${PENDING_TIMEOUT_MS}ms — desligando o seguidor nesta transmissão`
    )
    stopFollowing()
    return
  }

  const windows = await listWindows()
  // `stopFollowing()` pode ter rodado durante o await (a live parou). O
  // alias abaixo também é o que mantém o estreitamento de tipo válido
  // dentro dos callbacks — `state` é um `let` de módulo, o TypeScript
  // desiste do narrowing assim que ele entra numa closure.
  const current = state
  if (!current) return
  const isAlive = (handle: string): boolean => windows.some((w) => handleOf(w) === handle)

  if (current.autoHandle) {
    // Único estado do seguidor que NÃO procura nada: enquanto a janela
    // escolhida por ele estiver viva, não há decisão a tomar.
    if (isAlive(current.autoHandle)) return

    logGstreamer(`gameWindowFollow: janela automática ${current.autoHandle} morreu`)
    current.autoHandle = null
    current.cooldownUntil = Date.now() + RETURN_COOLDOWN_MS

    // Se a janela original também já foi (o usuário fechou o cliente no
    // meio da partida), não há pra onde voltar — e é exatamente o que
    // deve acontecer: sem troca, o pipeline continua apontado pra uma
    // janela morta, o gst-launch cai e o onExited do renderer derruba a
    // sala, como em qualquer captura de janela fechada.
    if (isAlive(current.originalHandle)) {
      requestSwitch(mainWindow, current.originalHandle)
    } else {
      logGstreamer(
        'gameWindowFollow: janela original também não existe mais — deixando a live cair'
      )
      stopFollowing()
    }
    return
  }

  if (Date.now() < current.cooldownUntil) return
  // O usuário fechou a janela que ele mesmo escolheu: a live cai, e isso
  // é o comportamento combinado. Não é papel do seguidor procurar
  // substituta.
  if (!isAlive(current.originalHandle)) return

  // Candidata: OUTRO processo (PID diferente — duas janelas do mesmo
  // processo não são "o jogo abriu", são só duas janelas) cujo
  // executável cai na mesma entrada da lista.
  const candidate = windows.find(
    (w) =>
      w.Id !== current.originalPid &&
      handleOf(w) !== current.originalHandle &&
      findGameByProcessName(w.ProcessName)?.name === current.gameName
  )
  if (!candidate) return

  logGstreamer(
    `gameWindowFollow: "${candidate.MainWindowTitle}" (${candidate.ProcessName}, pid ${candidate.Id}) ` +
      `é do mesmo jogo (${current.gameName}) — trocando`
  )
  current.autoHandle = handleOf(candidate)
  requestSwitch(mainWindow, current.autoHandle)
}

// Quantas vezes procurar pra onde voltar antes de desistir, e o intervalo
// entre elas (2026-09-20).
//
// Insistir é o ponto. A lista de janelas vem de
// `Get-Process | Where MainWindowHandle -ne 0` (ver WINDOW_SCRIPT), e
// uma janela ESCONDIDA tem handle 0 — ou seja, não existe pra nós. É
// exatamente o estado do cliente do LoL durante a partida: ele se
// recolhe pra bandeja e só reaparece no fim — e esse "fim" não é
// instantâneo. Olhando uma vez só, no instante em que a janela do jogo
// fecha, a chance de concluir "as duas janelas sumiram" e derrubar uma
// live perfeitamente viva é grande. Era o que acontecia.
//
// ~6s de teto (5 tentativas) cabem folgados na folga que o servidor
// concede pra uma reconexão anunciada (25s, ver roomReconnect.ts), com
// espaço de sobra pro pipeline novo ainda subir depois disso.
const RECOVERY_LOOKUP_ATTEMPTS = 5
const RECOVERY_LOOKUP_RETRY_MS = 1200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Pra onde voltar quando a janela do jogo fecha.
//
// A preferência é sempre a janela que o USUÁRIO escolheu. O segundo
// lugar — qualquer outra janela do mesmo jogo — foi pedido pelo usuário
// (2026-09-20) e cobre o cliente que não é mais o MESMO: alguns
// launchers destroem e recriam a janela ao voltar do jogo, e aí o HWND
// guardado aponta pra algo que não existe mais, mesmo com o cliente ali
// na tela. Sem esse segundo lugar, a live caía com a janela de destino
// visível na frente do usuário.
//
// A pergunta "é do mesmo jogo?" é a mesma da ida (ver o `tick`): a
// entrada da lista do Discord, que agrupa cliente e jogo sob um nome só.
function pickReturnTarget(
  current: FollowState,
  windows: WindowInfo[],
  deadHandle: string
): WindowInfo | null {
  const original = windows.find((w) => handleOf(w) === current.originalHandle)
  if (original) return original

  return (
    windows.find(
      (w) =>
        handleOf(w) !== deadHandle &&
        findGameByProcessName(w.ProcessName)?.name === current.gameName
    ) ?? null
  )
}

// A live está numa janela escolhida pelo SEGUIDOR (e não pelo usuário)?
//
// Existe pra quem trata a morte do processo poder avisar o servidor que
// uma reconexão está a caminho ANTES de saber se ela vai dar certo (ver
// handleUnexpectedExit em gstreamerCapture.ts) — a decisão leva
// segundos, e a sala está no relógio desde o primeiro deles.
export function isFollowingAutoWindow(): boolean {
  return state !== null && state.autoHandle !== null && state.pending === null
}

// O processo do GStreamer morreu sozinho — dá pra salvar a live
// trocando de janela? (2026-09-14)
//
// ---------------------------------------------------------------------
// O BUG QUE ISTO CONSERTA
//
// Teste real do usuário: cliente do LoL -> partida (trocou certo) ->
// FIM da partida -> a live caiu, em vez de voltar pro cliente.
//
// A lógica de voltar existia e estava certa; ela só nunca era
// alcançada. A janela do jogo fechando mata as DUAS coisas ao mesmo
// tempo, e uma delas é muito mais rápida:
//
//   - o `gst-launch` capturando aquele HWND morre na hora, e o
//     `child.on("exit")` chamava `stopFollowing()` e avisava o
//     renderer, que derrubava a sala;
//   - o tick do seguidor só rodaria até 4s DEPOIS — e já sem estado
//     nenhum pra agir.
//
// Ou seja: o caminho lento perdia a corrida pro caminho que desiste.
// Esta função é o caminho rápido — ela roda dentro do próprio evento
// de morte do processo, antes de qualquer coisa ser desfeita.
// ---------------------------------------------------------------------
//
// Só devolve `true` quando tem CERTEZA de que a morte foi a janela do
// jogo fechando:
//
//   1. o seguidor está no estado automático (a live está na janela
//      que ELE escolheu, não na que o usuário escolheu);
//   2. essa janela realmente não existe mais — se ela está viva, o
//      processo morreu por outro motivo (encoder, WHIP, driver) e
//      trocar de fonte só esconderia o problema de verdade;
//   3. existe pra onde voltar: a janela original ou — desde 2026-09-20
//      — outra janela do mesmo jogo.
//
// A condição 2 se pergunta uma vez só, na primeira olhada: se a janela
// do jogo ainda está viva AGORA, a morte não foi ela, ponto. Já a 3 se
// pergunta várias vezes ao longo de alguns segundos (ver
// RECOVERY_LOOKUP_ATTEMPTS) — "não achei o cliente" logo depois de uma
// partida costuma significar "ainda não", e não "nunca mais".
//
// Cada olhada custa uma enumeração de janelas (~85ms) no meio do caminho
// crítico. Vale: sem ela a decisão seria um chute — "morreu, deve ter sido a
// janela" — e errar significa trocar a fonte de uma live cujo problema
// era outro.
export async function tryRecoverFromExit(mainWindow: BrowserWindow): Promise<boolean> {
  const current = state
  // `pending` aqui significa que a gente JÁ tinha pedido uma troca e o
  // processo morreu no meio dela. Insistir seria empilhar troca sobre
  // troca; melhor deixar a live cair e o erro aparecer.
  if (!current || !current.autoHandle || current.pending) return false
  const autoHandle = current.autoHandle
  current.recovering = true
  try {
    return await lookForReturnTarget(mainWindow, current, autoHandle)
  } finally {
    // O `state` pode ter sido zerado no meio (a live parou) — mexer no
    // objeto antigo é inofensivo, e não custa a checagem.
    current.recovering = false
  }
}

async function lookForReturnTarget(
  mainWindow: BrowserWindow,
  current: FollowState,
  autoHandle: string
): Promise<boolean> {
  for (let attempt = 1; attempt <= RECOVERY_LOOKUP_ATTEMPTS; attempt++) {
    const windows = await listWindows()
    // A live parou (ou o usuário trocou de fonte na mão) enquanto a
    // gente enumerava/esperava — o estado de agora não é mais o que
    // estava sendo consertado.
    if (state !== current) return false

    if (attempt === 1 && windows.some((w) => handleOf(w) === autoHandle)) {
      logGstreamer(
        `gameWindowFollow: processo morreu mas a janela ${autoHandle} continua viva — ` +
          'não é troca de janela, deixando a live cair'
      )
      return false
    }

    const target = pickReturnTarget(current, windows, autoHandle)
    if (!target) {
      if (attempt < RECOVERY_LOOKUP_ATTEMPTS) {
        logGstreamer(
          `gameWindowFollow: nenhuma janela de "${current.gameName}" visível ainda ` +
            `(tentativa ${attempt}/${RECOVERY_LOOKUP_ATTEMPTS}) — esperando`
        )
        await delay(RECOVERY_LOOKUP_RETRY_MS)
      }
      continue
    }

    const handle = handleOf(target)
    if (handle !== current.originalHandle) {
      logGstreamer(
        `gameWindowFollow: a janela original ${current.originalHandle} não voltou, mas ` +
          `"${target.MainWindowTitle}" (${target.ProcessName}, pid ${target.Id}) é do mesmo ` +
          'jogo — ela vira a janela de origem daqui pra frente'
      )
      // Vira a nova ORIGEM, e não um segundo nível de automático: é dela
      // que a live parte agora, e é pra ela que uma próxima partida vai
      // voltar. Sem isso o estado ficaria apontando pra um HWND morto, e
      // a partida seguinte não teria pra onde voltar.
      current.originalHandle = handle
      current.originalPid = target.Id
    }

    logGstreamer(
      `gameWindowFollow: a janela ${autoHandle} fechou e levou o pipeline junto — ` +
        `voltando pra ${handle} sem derrubar a sala`
    )
    current.autoHandle = null
    current.cooldownUntil = Date.now() + RETURN_COOLDOWN_MS
    requestSwitch(mainWindow, handle)
    return true
  }

  logGstreamer(
    `gameWindowFollow: nenhuma janela de "${current.gameName}" apareceu em ` +
      `${RECOVERY_LOOKUP_ATTEMPTS} tentativas — deixando a live cair`
  )
  return false
}

// Chamado pelos handlers gstreamer:start e gstreamer:update, sempre que a
// fonte capturada muda — inclusive quando quem mudou foi este módulo.
// Distinguir os dois casos é o ponto: uma troca MANUAL (o usuário mexeu
// no modal de fonte) desarma o automático e recomeça do zero a partir da
// nova escolha; a troca que a gente mesmo pediu só confirma o `pending`.
export function handleFollowSourceChanged(
  mainWindow: BrowserWindow,
  sourceId: string | null,
  captureArg: {
    name: string
    value: string
    windowPid?: number
    windowProcessName?: string
  }
): void {
  if (state) {
    // A troca que a gente mesmo pediu chegou: só confirma.
    if (state.pending?.sourceId === sourceId) {
      state.pending = null
      return
    }
    // Mesma janela que já estamos seguindo, mas não fomos nós que
    // pedimos: o usuário mexeu em resolução/FPS no modal enquanto o
    // automático estava ativo. Sem esse caso o estado seria recriado com
    // a janela do JOGO como "original", e no fim da partida não haveria
    // pra onde voltar — a live cairia em vez de voltar pro cliente.
    if (state.autoHandle && sourceId === `${WINDOW_HANDLE_PREFIX}${state.autoHandle}`) return
  }

  stopFollowing()

  // Monitor inteiro não tem o que seguir: o jogo já vai aparecer na tela
  // sozinho, seja em que janela for.
  if (captureArg.name !== 'window-handle') return

  const game = findGameByProcessName(captureArg.windowProcessName)
  // A janela escolhida não é um jogo conhecido (Chrome, VS Code, OBS...):
  // o seguidor simplesmente não liga. Sem entrada na lista não existe
  // "mesma entrada", então não há risco de falso positivo fora de jogo.
  if (!game || captureArg.windowPid === undefined) return

  state = {
    gameName: game.name,
    originalHandle: captureArg.value,
    originalPid: captureArg.windowPid,
    autoHandle: null,
    cooldownUntil: 0,
    pending: null,
    recovering: false
  }
  logGstreamer(
    `gameWindowFollow: seguindo "${game.name}" a partir do HWND ${captureArg.value} (pid ${captureArg.windowPid})`
  )
  timer = setInterval(() => {
    tick(mainWindow).catch((err) => logGstreamer(`gameWindowFollow: erro no tick: ${err}`))
  }, TICK_MS)
}
