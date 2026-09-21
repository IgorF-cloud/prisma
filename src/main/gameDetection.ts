import { execFile } from 'child_process'
import { BrowserWindow } from 'electron'
import { API_BASE_URL } from './config'
import { authHeader } from './apiToken'
import {
  DetectedGame,
  findGameByProcessName,
  findGameBySteamId,
  getExeToGameMap
} from './gameDetectableCache'
import { getWindowIconDataUrl } from './windowIcon'
import { findSteamGameByAppId, findSteamGameByExePath } from './steamLibrary'

// Roadmap item 29: identifica o jogo (ou janela) que o host está
// transmitindo, pra mostrar pro próprio host (footer, ver
// useGstreamerTransmission.ts) e pros viewers (tile da sala na lista, ver
// server.js `POST /rooms/:roomName/game`).
//
// O nome e a arte SEMPRE vêm da lista do Discord (ver
// gameDetectableCache.ts). O que existem são duas formas de descobrir
// QUAL entrada da lista é a certa, nesta ordem de prioridade:
//
//   1. APPID DA STEAM (RunningAppID no registro) x os `steamIds` da
//      lista. É uma chave EXATA: ou é aquele jogo, ou não é.
//   2. APPID x os MANIFESTOS da Steam no disco (steamLibrary.ts), pro
//      jogo que a lista não conhece — demos, playtests, lançamentos
//      recentes. Dá o nome certo, sem arte.
//   3. NOME DO PROCESSO x executáveis da lista. Cobre 10.449 jogos,
//      inclusive os que não são da Steam — mas casa por um nome de
//      arquivo, que nem sempre identifica nada.
//
// A escada inteira, como o usuário desenhou em 2026-09-14:
//
//   TEM appid rodando?  -> lista do Discord (nome + arte)
//                       -> manifesto no disco (nome, sem arte)
//   NÃO tem appid?      -> lista do Discord pelo executável
//                       -> monitor: "Screen 1" / janela: título + ícone
//
// A ideia por trás dela: ter um appid é saber EXATAMENTE qual jogo é.
// Enquanto essa certeza existir, ela manda — mesmo quando obriga a
// abrir mão da arte. Só quando não há appid nenhum é que vale apelar
// pro palpite por nome de arquivo.
//
// ---------------------------------------------------------------------
// A ORDEM JÁ FOI A INVERSA (até 2026-09-14)
//
// O argumento de antes era: "o processo é evidência do que está NA
// TELA, o RunningAppID é global". Soa bem, mas não se sustenta no caso
// que importa — o MONITOR inteiro, onde a varredura de processos olha
// TODOS os processos da máquina, não o que está em foco. Os dois lados
// são igualmente "globais"; a diferença real é que um é exato e o outro
// é um palpite por nome de arquivo.
//
// E o palpite erra. Dois casos que o usuário encontrou jogando
// (2026-09-14):
//
//   - "SlashZero Demo", cujo executável é `zero.exe`, virava
//     "The Legend of Heroes: Trails from Zero" — que registra
//     `the legend of heroes trails from zero/zero.exe` na lista, e o
//     mapa do app casa só pelo nome do arquivo;
//   - "Ignite the Depths Playtest" idem, virava outro jogo.
//
// Nos dois, a Steam sabia exatamente qual era o jogo. Por isso ela
// passou a ser a PRIMEIRA fonte: um appid não casa por acaso.
// ---------------------------------------------------------------------
//
// O que muda por tipo de captura:
//
//   - MONITOR inteiro: pergunta à Steam; sem resposta, varre TODOS os
//     processos rodando (polling de 8s — o jogo pode abrir/fechar no
//     meio da live); sem nada, cai pro nome do monitor
//     ("Transmitindo: Screen 1").
//   - JANELA específica: a Steam só é consultada se o executável DAQUELA
//     janela estiver sob \steamapps\ — ver `detectWindowNowPlaying`.
//     Essa amarração continua valendo, e é o que impede uma janela do
//     Chrome de virar "Jogando: <jogo aberto atrás>". Passando por ela,
//     a Steam vem primeiro; senão, cruza o processo dono da janela. Sem
//     nada, o título da janela mesmo ("Transmitindo: <título>").
// `kind` decide o rótulo ("Jogando:" pra game, "Transmitindo:" pros
// outros dois) E o ícone do placeholder quando não há arte (controle /
// monitor / janela, ver HomeScreen.tsx). 'screen' virou um kind próprio
// em 2026-09-05 (antes um monitor sem jogo detectado era reportado como
// 'window'): o rótulo continua igual, mas o placeholder não.
export interface NowPlaying {
  kind: 'game' | 'window' | 'screen'
  name: string
  // Arte do jogo (CDN do Discord) — null pra janela/monitor, e também pro
  // jogo cujo app não tem ícone na lista (~17% deles).
  iconUrl?: string | null
}

const POLL_INTERVAL_MS = 8000

let pollTimer: ReturnType<typeof setInterval> | null = null
// undefined = nada reportado ainda nesse ciclo de transmissão (força o
// primeiro report mesmo que o resultado seja null); depois disso, guarda o
// último valor reportado pra não mandar POST/broadcastRooms toda vez que o
// polling roda sem NENHUMA mudança real.
let lastReported: NowPlaying | null | undefined = undefined

// A sala da transmissão em andamento, ou null quando não há nenhuma.
// Existe pro reenvio depois de uma reconexão (ver
// resendNowPlayingAfterReconnect) — todo o resto recebe o roomCode por
// parâmetro, mas quem descobre que a conexão voltou é o rooms.ts, que
// não tem como saber de qual sala se trata.
let activeRoomCode: string | null = null

// REATIVADA em 2026-09-06 (esteve desativada entre 2026-09-05 e essa
// data). Continua sendo a mesma leitura de sempre, mas o USO mudou: o
// appid agora resolve nome E arte na lista do Discord
// (`findGameBySteamId`), em vez de ir buscar só o nome na API da loja da
// Steam — por isso a `fetchSteamGameName` logo abaixo segue comentada,
// não tem mais função.
//
// Lê HKCU\Software\Valve\Steam\RunningAppID — a Steam grava esse valor com
// o AppID do jogo em execução (0 quando nenhum). Mesma leitura do app
// Flutter antigo (lib/core/steam_game_detector.dart): chave ausente/erro
// qualquer conta como "nenhum jogo" (0), não como falha.
//
// `reg.exe` desde 2026-09-14, no lugar do PowerShell. O motivo é a
// mudança de ordem: enquanto a Steam era fallback, isto só rodava
// quando NENHUM processo batia — agora roda a cada tick do polling (8s)
// pra sempre. Subir o runtime do PowerShell custa 150-300ms por
// chamada; o `reg.exe` é um executável nativo minúsculo e responde em
// poucos milissegundos. Mesmo raciocínio que já tinha levado o
// `listRunningProcessNames` pro `tasklist.exe` em vez do PowerShell.
//
// Saída do reg.exe:
//
//     HKEY_CURRENT_USER\Software\Valve\Steam
//         RunningAppID    REG_DWORD    0x0
//
// O valor vem em HEXADECIMAL — daí o parse com base 16. Ler como
// decimal devolveria 0 pra qualquer appid (todos começam com "0x").
function readRunningSteamAppId(): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(0)
        const match = stdout.match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i)
        if (!match) return resolve(0)
        const value = Number.parseInt(match[1], 16)
        resolve(Number.isFinite(value) ? value : 0)
      }
    )
  })
}

// Resolve o jogo que a Steam diz estar rodando. Dois degraus:
//
//   1. a lista do Discord, que dá nome E arte;
//   2. o manifesto da Steam no disco, que dá só o nome — e é o que
//      cobre demo/playtest/lançamento recente, que a lista não tem
//      (2026-09-14, ver steamLibrary.ts).
//
// Null quando não há jogo rodando, ou quando há um que nem a lista nem
// a biblioteca local sabem nomear.
async function detectViaSteam(): Promise<NowPlaying | null> {
  const appId = await readRunningSteamAppId()
  if (appId <= 0) return null

  const naLista = findGameBySteamId(appId)
  if (naLista) return { kind: 'game', name: naLista.name, iconUrl: naLista.iconUrl }

  const noDisco = await findSteamGameByAppId(appId)
  // `iconUrl: null` com `kind: game` é o que faz aparecer o
  // placeholder da Steam (ver NowPlayingArt.tsx) — o manifesto não tem
  // imagem nenhuma.
  if (noDisco) return { kind: 'game', name: noDisco.name, iconUrl: null }

  return null
}
//
// GET da própria loja da Steam, sem autenticação — mesma API que o app
// Flutter já usava. success:false (DLC/software/appid inválido) devolve
// null, não é tratado como erro.
// async function fetchSteamGameName(appId: number): Promise<string | null> {
//   if (appId <= 0) return null
//   try {
//     const response = await fetch(
//       `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`,
//       { signal: AbortSignal.timeout(6000) }
//     )
//     if (!response.ok) return null
//     const body = (await response.json()) as Record<
//       string,
//       { success?: boolean; data?: { name?: string } }
//     >
//     const entry = body[String(appId)]
//     if (!entry?.success) return null
//     return entry.data?.name ?? null
//   } catch {
//     return null
//   }
// }

// Lista de processos rodando via `tasklist` (utilitário nativo do
// Windows) — o jeito mais leve encontrado de listar processos pra esse
// polling: evita o custo de subir o runtime do PowerShell (~150-300ms) a
// cada tick, só o parsing de uma saída CSV simples.
function listRunningProcessNames(): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/fo', 'csv', '/nh'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(new Set())
      const names = new Set<string>()
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^"([^"]+)"/)
        if (match) names.add(match[1].toLowerCase())
      }
      resolve(names)
    })
  })
}

// O "filtro" de verdade já é a própria lista de jogos conhecidos — não
// precisa de exclusão nenhuma à parte pra processos de sistema, eles
// simplesmente nunca batem contra o mapa. O mapa (exe -> nome do jogo) já
// vem pronto de gameDetectableCache.ts, construído uma vez por lista
// carregada (não a cada tick).
async function detectViaDiscordList(): Promise<DetectedGame | null> {
  const exeToGame = getExeToGameMap()
  if (exeToGame.size === 0) return null
  const processNames = await listRunningProcessNames()
  for (const proc of processNames) {
    const game = exeToGame.get(proc)
    if (game) return game
  }
  return null
}

// Usada só no MONITOR inteiro. Steam primeiro, processo depois — ver a
// explicação da ordem no cabeçalho do arquivo. Aqui a Steam não precisa
// de amarração nenhuma: a tela toda está sendo compartilhada, então "que
// jogo está rodando nesta máquina" é exatamente a pergunta certa.
async function detectNowPlaying(): Promise<NowPlaying | null> {
  const porSteam = await detectViaSteam()
  if (porSteam) return porSteam

  const porProcesso = await detectViaDiscordList()
  if (porProcesso) {
    return { kind: 'game', name: porProcesso.name, iconUrl: porProcesso.iconUrl }
  }

  return null
}

function sameNowPlaying(a: NowPlaying | null, b: NowPlaying | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  // `iconUrl` entra na comparação (2026-09-05) porque ele pode mudar sem
  // o nome mudar — ex: a lista do Discord é rebaixada no meio da live e o
  // hash do ícone daquele app mudou. Sem isso o dedupe engoliria a
  // atualização e o footer ficaria com a arte velha.
  return a.kind === b.kind && a.name === b.name && (a.iconUrl ?? null) === (b.iconUrl ?? null)
}

async function postGameReport(roomCode: string, info: NowPlaying | null): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/rooms/${roomCode}/game`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        info
          ? { kind: info.kind, name: info.name, iconUrl: info.iconUrl ?? null }
          : { kind: null, name: null, iconUrl: null }
      )
    })
    return response.ok
  } catch (err) {
    console.error(`Erro ao reportar jogo/janela pra sala ${roomCode}:`, err)
    return false
  }
}

// Propaga o resultado pros dois lados: renderer local (footer do próprio
// host — ele nunca aparece na SUA PRÓPRIA lista de salas, ver ROADMAP.md
// item 18, então precisa desse canal à parte) e o token-server (pra
// espalhar pro tile da sala na lista de quem NÃO é o host, via
// broadcastRooms). Dedupe por igualdade de valor: sem isso, cada tick do
// polling (8s) geraria um POST + broadcast pra sala inteira mesmo sem
// nenhuma mudança real.
//
// `lastReported` só avança em caso de sucesso — se o POST falhar (ex: a
// sala ainda não existe em roomsState, corrida com o webhook
// room_started, ver server.js), o próximo tick do polling (8s depois,
// modo monitor) tenta reportar esse MESMO valor de novo, em vez de achar
// que já reportou. Devolve se deu certo, pro caso de janela (sem polling
// nenhum) poder insistir também — ver reportNowPlayingWithRetry.
async function reportNowPlaying(
  mainWindow: BrowserWindow,
  roomCode: string,
  info: NowPlaying | null
): Promise<boolean> {
  if (lastReported !== undefined && sameNowPlaying(info, lastReported)) return true

  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('games:nowPlayingUpdate', info)
  }

  const ok = await postGameReport(roomCode, info)
  if (ok) lastReported = info
  return ok
}

// Pedido do usuário (2026-09-05): a captura de JANELA passa a usar a
// mesma lista do Discord que o monitor inteiro já usava — se o processo
// DONO da janela escolhida estiver na lista, mostra "Jogando: <nome do
// jogo>" em vez de "Transmitindo: <título da janela>". Sem match (ou sem
// nome de processo nenhum), continua caindo no título da janela, como
// antes.
//
// A normalização do nome do processo (vem sem `.exe`, a lista indexa com)
// mora em `findGameByProcessName`, ver gameDetectableCache.ts.
//
// Sem polling de propósito, igual já era: a janela transmitida é fixa
// durante a live (trocar de fonte passa por aqui de novo, ver
// handleTransmissionSourceChanged), então não tem o que re-detectar. Isso
// vale mesmo com a troca automática de janela (2026-09-10,
// gameWindowFollow.ts): ela também passa por
// handleTransmissionSourceChanged, e como cliente e jogo caem na MESMA
// entrada da lista, o nome reportado nem muda — o `sameNowPlaying`
// deduplica e o viewer vê "Jogando: X" contínuo através da troca.
async function detectWindowNowPlaying(
  windowTitle: string,
  processName?: string,
  processPath?: string | null
): Promise<NowPlaying> {
  // Jogo da Steam? A pergunta é sobre a JANELA, não sobre a máquina.
  //
  // `\steamapps\` no caminho do executável é o que amarra as duas
  // pontas: todo jogo instalado pela Steam mora sob
  // `...\steamapps\common\<jogo>\`. Sem essa amarração, transmitir uma
  // janela do Chrome com um jogo Steam aberto atrás mostraria
  // "Jogando: <jogo>" — errado, é o Chrome que está na tela.
  //
  // E aqui a ordem é diferente da do monitor: o CAMINHO vem antes do
  // RunningAppID. Os dois respondem perguntas diferentes — o registro
  // diz o que a Steam lançou, o caminho diz de quem é esta janela — e
  // aqui só a segunda importa. Com duas Steams abertas, o registro
  // apontaria pra outra.
  //
  // O manifesto ainda devolve o APPID, então dá pra tentar a lista do
  // Discord de novo por ele (agora pelo appid certo, com arte) antes de
  // cair no nome sem arte.
  if (isSteamGamePath(processPath) && processPath) {
    const local = await findSteamGameByExePath(processPath)
    if (local) {
      const naLista = local.appId > 0 ? findGameBySteamId(local.appId) : null
      return naLista
        ? { kind: 'game', name: naLista.name, iconUrl: naLista.iconUrl }
        : { kind: 'game', name: local.name, iconUrl: null }
    }

    // Biblioteca ilegível: o RunningAppID ainda é uma evidência
    // razoável, já que a janela é comprovadamente de um jogo da Steam.
    const porSteam = await detectViaSteam()
    if (porSteam) return porSteam
  }

  // Não é jogo da Steam, ou a Steam não soube dizer: cruza o executável
  // dono da janela com a lista.
  const game = findGameByProcessName(processName)
  if (game) return { kind: 'game', name: game.name, iconUrl: game.iconUrl }

  // Nem jogo conhecido nem jogo da Steam: é uma janela comum, e o que
  // identifica ela pra quem assiste é o ícone do próprio programa
  // (2026-09-14). Vai como data URL — ver windowIcon.ts.
  //
  // `null` quando não dá pra ler o ícone; aí o app cai no desenho de
  // placeholder de janela, como antes.
  return {
    kind: 'window',
    name: windowTitle,
    iconUrl: await getWindowIconDataUrl(processPath)
  }
}

// Windows não diferencia caixa em caminhos, daí o `toLowerCase`. Checa o
// segmento com as barras dos dois lados pra não casar com uma pasta que
// só COMECE com "steamapps" (ex: "steamapps-backup").
function isSteamGamePath(processPath?: string | null): boolean {
  if (!processPath) return false
  return processPath.toLowerCase().replace(/\//g, '\\').includes('\\steamapps\\')
}

// Captura de JANELA não tem polling (o título não muda sozinho) — só uma
// chamada, no início da transmissão. Sem retry, essa chamada corria risco
// real de se perder pra sempre numa corrida com o webhook room_started
// (o Electron chama isso logo após spawnar o processo GStreamer, mas a
// sala só existe pro LiveKit quando o WHIP começa a publicar de verdade —
// pode demorar mais que essa primeira tentativa). Insiste algumas vezes
// com um intervalo curto antes de desistir.
async function reportNowPlayingWithRetry(
  mainWindow: BrowserWindow,
  roomCode: string,
  info: NowPlaying
): Promise<void> {
  const MAX_ATTEMPTS = 6
  const RETRY_DELAY_MS = 1500

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ok = await reportNowPlaying(mainWindow, roomCode, info)
    if (ok) return
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
}

function stopPollingOnly(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  lastReported = undefined
  activeRoomCode = null
}

// O SERVIDOR PODE TER ESQUECIDO O QUE EU REPORTEI (2026-09-21).
//
// Chamado quando o WebSocket de salas (re)conecta — ver rooms.ts. O caso
// que motivou: o prisma_server reinicia no meio de uma live (um deploy,
// por exemplo). A live não cai, porque quem carrega a mídia é o LiveKit,
// mas o servidor reconstrói as salas do zero e, até 2026-09-21, sem o
// jogo. Quem assistia via o "Jogando: X" sumir do tile.
//
// O servidor agora guarda isso no metadata da sala e recupera sozinho —
// isto aqui é o segundo cinto, e vale pra qualquer outro jeito de o
// report se perder (um POST que falhou, uma sala recriada).
//
// Não dá pra só esperar o polling: ele deduplica por VALOR (`lastReported`
// abaixo), e depois de um restart o valor não mudou — o host ficaria
// calado pra sempre. Por isso o dedupe é zerado antes de reenviar. E no
// modo JANELA não existe polling nenhum, então sem isto não havia
// segunda chance.
export function resendNowPlayingAfterReconnect(mainWindow: BrowserWindow): void {
  // `undefined` = nada reportado ainda; `null` = reportado como "sem
  // jogo", que é o padrão do servidor — em nenhum dos dois há o que
  // recuperar.
  if (!activeRoomCode || !lastReported) return

  const roomCode = activeRoomCode
  const info = lastReported
  lastReported = undefined

  // Com retry: o socket voltar não garante que a sala já existe de novo
  // no servidor (ele reconstrói as salas do LiveKit no boot, e o webhook
  // pode chegar depois).
  void reportNowPlayingWithRetry(mainWindow, roomCode, info)
}

// Chamado sempre que uma transmissão inicia ou troca de fonte (item 13,
// UpdateTransmissionModal) — decide se é caso de detecção via polling
// (monitor inteiro) ou só usar o título da janela direto (captura de
// janela específica, sem detecção nenhuma), reiniciando do zero em
// qualquer um dos dois casos (cobre trocar de monitor pra janela ou
// vice-versa).
export async function handleTransmissionSourceChanged(
  mainWindow: BrowserWindow,
  roomCode: string,
  captureArg: {
    name: string
    value: string
    windowTitle?: string
    windowProcessName?: string
    windowProcessPath?: string | null
    sourceName?: string
  }
): Promise<void> {
  stopPollingOnly()
  // Depois do stop, que zera isto junto com o resto do estado do ciclo
  // anterior.
  activeRoomCode = roomCode

  if (captureArg.name === 'window-handle') {
    await reportNowPlayingWithRetry(
      mainWindow,
      roomCode,
      await detectWindowNowPlaying(
        captureArg.windowTitle ?? 'Janela',
        captureArg.windowProcessName,
        captureArg.windowProcessPath
      )
    )
    return
  }

  // Pedido do usuário (2026-09-03): transmitindo um monitor inteiro sem
  // NENHUM jogo detectado, mostra o nome do próprio monitor escolhido
  // (mesmo nome já exibido na grade de seleção da TransmissionScreen, ex:
  // "Screen 1") em vez de nada — "Transmitindo: <nome do monitor>".
  //
  // `kind: 'screen'` desde 2026-09-05 (era 'window'): o rótulo exibido
  // continua o mesmo, mas o footer precisa saber que é uma TELA pra
  // escolher o ícone do placeholder (monitor, não janela).
  const monitorFallback: NowPlaying | null = captureArg.sourceName
    ? { kind: 'screen', name: captureArg.sourceName, iconUrl: null }
    : null

  // Pedido do usuário (2026-09-03): reporta esse fallback JÁ, sem
  // esperar a detecção terminar (Steam/tasklist, ~1s) — o título (AO
  // VIVO/código) já aparece assim que a sala é criada, então o
  // subtítulo ficava vazio por um instante até a primeira detecção
  // resolver. Reportar o nome do monitor de cara faz os dois aparecerem
  // juntos; `tick()` abaixo roda em seguida e substitui isso quase na
  // hora se achar um jogo de verdade (o dedupe do reportNowPlaying evita
  // reenviar à toa quando o resultado bate com esse mesmo fallback).
  if (monitorFallback) {
    reportNowPlaying(mainWindow, roomCode, monitorFallback).catch((err) =>
      console.error(`Erro ao reportar fallback de monitor pra sala ${roomCode}:`, err)
    )
  }

  const tick = async (): Promise<void> => {
    const info = (await detectNowPlaying()) ?? monitorFallback
    await reportNowPlaying(mainWindow, roomCode, info)
  }

  await tick()
  pollTimer = setInterval(tick, POLL_INTERVAL_MS)
}

// Chamado ao parar a transmissão (gstreamer:stop) — limpa o polling E
// avisa a sala/host que não tem mais jogo/janela sendo exibido.
export async function stopGameDetection(
  mainWindow: BrowserWindow,
  roomCode: string | null
): Promise<void> {
  stopPollingOnly()
  if (roomCode) await reportNowPlaying(mainWindow, roomCode, null)
}

// Usado no fechamento abrupto do app (stopForAppQuit, ver
// gstreamerCapture.ts) — só limpa o timer local, sem chamada de rede
// nenhuma (mesmo espírito do resto de stopForAppQuit: não travar o
// fechamento esperando o token-server responder; a sala inteira já está
// sendo derrubada de qualquer forma).
export function stopGameDetectionForAppQuit(): void {
  stopPollingOnly()
}
