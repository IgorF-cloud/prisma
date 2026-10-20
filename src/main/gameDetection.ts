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
//     nada, o título da janela mesmo ("Transmitindo: <título>"). Também
//     no polling de 8s desde 2026-09-24 — mas SEM a varredura de todos
//     os processos da máquina, que é exclusiva do monitor.
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

// Intervalo curto, usado só enquanto o report NÃO cola (ver `runCycle`).
// O caso normal é a corrida com o webhook room_started: o app reporta
// logo depois de spawnar o GStreamer, mas a sala só existe pro LiveKit
// quando o WHIP começa a publicar de verdade, e até lá o POST devolve
// 404. Esperar os 8s cheios a cada tentativa deixaria o tile de quem
// assiste mudo por tempo demais.
const RETRY_DELAY_MS = 1500

// ...mas só nas primeiras tentativas. Passado isso o ciclo volta ao
// ritmo normal de 8s, e é aí que ele pode insistir pra sempre sem pesar.
//
// O que isto evita é um martelo: uma transmissão que morre sem passar
// pelo `stopGameDetection` (o processo do GStreamer some de um jeito que
// ninguém trata) deixaria o ciclo batendo de 1,5s em 1,5s no servidor
// pelo resto da sessão do app. Seis é o mesmo teto que o retry antigo
// tinha — o suficiente pra ganhar a corrida com o room_started, que é a
// única coisa pra que a pressa serve.
const FAST_RETRY_ATTEMPTS = 6

// DE QUANTO EM QUANTO TEMPO REAFIRMAR O QUE JÁ FOI REPORTADO (2026-09-24)
//
// O report é deduplicado por VALOR (`lastReported`), e é isso que impede
// um POST + broadcast pra sala inteira a cada 8s sem mudança nenhuma. O
// preço é que, se o SERVIDOR esquecer, o host fica calado pra sempre — o
// valor dele não mudou.
//
// Esquecer acontece de mais de um jeito, e só um deles estava coberto:
//
//   - o prisma_server reinicia: coberto desde 2026-09-21, dos dois lados
//     (metadata da sala no LiveKit + `resendNowPlayingAfterReconnect`);
//   - a SALA é recriada no meio da live — a folga de "sala sem host"
//     estoura numa troca de fonte e o LiveKit recria a sala no publisher
//     seguinte. Aí o `room_started` grava `game: null` e NADA avisa o
//     app: o WebSocket nem chega a cair, e a recuperação via metadata só
//     roda no boot do servidor.
//
// Daí este heartbeat: de tempos em tempos o valor atual é reenviado
// mesmo sem ter mudado. Um POST por minuto por host transmitindo é
// barato perto de uma live inteira sem mostrar o que está passando.
const REASSERT_INTERVAL_MS = 60_000

let pollTimer: ReturnType<typeof setTimeout> | null = null

// QUEM AINDA MANDA (2026-09-24)
//
// Todo ciclo de transmissão (start, troca de fonte, troca automática de
// janela) começa com um `stopPollingOnly()`, que incrementa isto. Cada
// passada carrega o número que viu ao nascer e desiste sozinha quando
// ele muda — é o que impede uma passada VELHA, ainda no meio de um
// await, de reportar por cima da nova.
//
// Sem isso o bug era real e fácil de disparar: o seguidor de janela
// troca de fonte 4s depois do início (TICK_MS em gameWindowFollow.ts),
// o retry do início ainda tem tentativas sobrando e, como o
// `stopPollingOnly` zera o `lastReported` junto, esse retry velho passa
// livre pelo dedupe e ressuscita a janela anterior no tile de quem
// assiste.
let generation = 0

// A passada do ciclo atual, pra `resendNowPlayingAfterReconnect` poder
// ANTECIPAR a próxima em vez de abrir um caminho de report paralelo —
// que era exatamente a fonte de corrida que o `generation` acima existe
// pra matar. null quando não há transmissão.
let currentCycle: (() => void) | null = null

// O `generation` sozinho garante que uma passada velha não GRAVA nada
// depois de ser substituída, mas não desfaz um POST que já saiu. Sobrava
// uma janela de um RTT em que o valor velho chegava ao servidor depois
// do novo — e aí o dedupe do app (que já acha que reportou o novo)
// calaria até o heartbeat, deixando o tile de quem assiste com a fonte
// anterior por até um minuto. Abortar de verdade fecha isso.
let reportAbort = new AbortController()

// undefined = nada reportado ainda nesse ciclo de transmissão (força o
// primeiro report mesmo que o resultado seja null); depois disso, guarda o
// último valor reportado pra não mandar POST/broadcastRooms toda vez que o
// polling roda sem NENHUMA mudança real.
let lastReported: NowPlaying | null | undefined = undefined
// Quando o servidor aceitou o `lastReported` — base do heartbeat acima.
let lastReportedAt = 0

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

async function postGameReport(
  roomCode: string,
  info: NowPlaying | null,
  signal: AbortSignal
): Promise<boolean> {
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
      ),
      signal
    })
    return response.ok
  } catch (err) {
    // Abortado = a fonte trocou no meio deste POST. Não é erro: quem
    // abortou já está reportando a fonte nova, e a passada que chamou
    // isto vai desistir sozinha no guard de geração.
    if (signal.aborted) return false
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
// room_started, ver server.js), quem chamou reagenda a passada seguinte
// com o intervalo curto e tenta reportar esse MESMO valor de novo, em vez
// de achar que já reportou. Devolve se deu certo justamente pra isso.
async function reportNowPlaying(
  mainWindow: BrowserWindow,
  roomCode: string,
  info: NowPlaying | null,
  gen: number
): Promise<boolean> {
  // Passada de um ciclo que já foi substituído: não reporta nada. Devolve
  // `true` porque isto NÃO é falha — só não é mais a vez dela. Um `false`
  // faria quem chamou reagendar uma tentativa rápida pra um ciclo que já
  // não existe.
  if (gen !== generation) return true

  const duplicate = lastReported !== undefined && sameNowPlaying(info, lastReported)
  // Reafirmação periódica (ver REASSERT_INTERVAL_MS): o valor não mudou,
  // mas já faz tempo demais desde o último "ok" do servidor pra confiar
  // que ele ainda lembra. Só pra valor de verdade — reafirmar "nada
  // sendo transmitido", que já é o padrão do servidor, seria uma chamada
  // de rede pra dizer nada.
  const reassert = info !== null && Date.now() - lastReportedAt >= REASSERT_INTERVAL_MS
  if (duplicate && !reassert) return true

  // O renderer só é avisado quando MUDA de verdade: o heartbeat manda o
  // mesmo valor de novo pro servidor, e o footer do host não tem por que
  // redesenhar por causa disso.
  if (!duplicate && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('games:nowPlayingUpdate', info)
  }

  // O signal é capturado ANTES do await: o `stopPollingOnly` troca o
  // controller por um novo, e o que interessa é o que estava valendo
  // quando este POST saiu.
  const ok = await postGameReport(roomCode, info, reportAbort.signal)
  // Confere a geração DE NOVO: o POST leva tempo, e uma troca de fonte
  // pode ter acontecido no meio dele. Gravar aqui sujaria o dedupe do
  // ciclo novo com o valor do ciclo velho.
  if (ok && gen === generation) {
    lastReported = info
    lastReportedAt = Date.now()
  }
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
// COM POLLING DE 8s DESDE 2026-09-24 (era uma chamada só, no início da
// transmissão). O argumento de antes era que a janela transmitida é fixa
// durante a live, então não teria o que re-detectar. Duas coisas
// derrubaram isso:
//
//   - a RESPOSTA pode mudar sem a janela mudar. O jogo da Steam ainda
//     está subindo quando a transmissão começa, a biblioteca local ainda
//     não foi lida, a lista do Discord ainda não terminou de baixar — em
//     qualquer um desses a primeira passada devolve o título da janela e
//     a segunda já devolve o jogo;
//   - e, principalmente, sem polling não havia SEGUNDA CHANCE DE
//     ENTREGA. Um report que não colasse dentro da janela curta de retry
//     se perdia pra sempre, e o tile de quem assiste ficava vazio pelo
//     resto da live. Era o buraco mais fácil de cair de todos.
//
// O que NÃO entrou junto foi varrer todos os processos da máquina como o
// monitor faz (decisão do usuário, 2026-09-24): a pergunta aqui é sobre
// a JANELA escolhida, e é justamente essa amarração que impede uma
// janela do Chrome de virar "Jogando: <jogo aberto atrás>".
//
// A passada é barata de propósito, porque roda a cada 8s: o ícone
// (windowIcon.ts) e a biblioteca da Steam (steamLibrary.ts) têm cache
// por caminho de executável, e o resto é lookup em mapa. O `reg.exe` só
// é tocado no caso raro de a janela ser comprovadamente de um jogo da
// Steam E a biblioteca local estar ilegível.
//
// A troca automática de janela (2026-09-10, gameWindowFollow.ts) não
// muda nada disso: ela passa por handleTransmissionSourceChanged, que
// reinicia o ciclo com a janela nova — e como cliente e jogo caem na
// MESMA entrada da lista, o nome reportado nem muda. O `sameNowPlaying`
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

// A fonte já resolvida pelo `resolveCaptureArg` (gstreamerCapture.ts) —
// monitor ou janela, com o que se descobriu dela na hora de resolver.
export interface TransmissionSource {
  name: string
  value: string
  windowTitle?: string
  windowProcessName?: string
  windowProcessPath?: string | null
  sourceName?: string
}

// Qual detector e qual fallback servem PARA ESTA FONTE. Era chamada
// também antes de a sala existir, pra mandar o jogo junto do POST
// /ingress (2026-09-30); desde 2026-10-16 a sala nasce com o nome da
// janela/monitor que o renderer já tem, e isto ficou só no polling.
function detectorsForSource(captureArg: TransmissionSource): {
  detect: () => Promise<NowPlaying | null>
  monitorFallback: NowPlaying | null
} {
  const isWindow = captureArg.name === 'window-handle'

  // Pedido do usuário (2026-09-03): transmitindo um monitor inteiro sem
  // NENHUM jogo detectado, mostra o nome do próprio monitor escolhido
  // (mesmo nome já exibido na grade de seleção da TransmissionScreen, ex:
  // "Screen 1") em vez de nada — "Transmitindo: <nome do monitor>".
  //
  // `kind: 'screen'` desde 2026-09-05 (era 'window'): o rótulo exibido
  // continua o mesmo, mas o footer precisa saber que é uma TELA pra
  // escolher o ícone do placeholder (monitor, não janela).
  //
  // Janela não tem equivalente disso porque não precisa:
  // `detectWindowNowPlaying` nunca devolve null — no pior caso devolve o
  // título da janela com o placeholder.
  const monitorFallback: NowPlaying | null =
    !isWindow && captureArg.sourceName
      ? { kind: 'screen', name: captureArg.sourceName, iconUrl: null }
      : null

  const detect = isWindow
    ? (): Promise<NowPlaying | null> =>
        detectWindowNowPlaying(
          captureArg.windowTitle ?? 'Janela',
          captureArg.windowProcessName,
          captureArg.windowProcessPath
        )
    : detectNowPlaying

  return { detect, monitorFallback }
}

// Windows não diferencia caixa em caminhos, daí o `toLowerCase`. Checa o
// segmento com as barras dos dois lados pra não casar com uma pasta que
// só COMECE com "steamapps" (ex: "steamapps-backup").
function isSteamGamePath(processPath?: string | null): boolean {
  if (!processPath) return false
  return processPath.toLowerCase().replace(/\//g, '\\').includes('\\steamapps\\')
}

function stopPollingOnly(): void {
  // Antes de qualquer outra coisa: invalida as passadas em voo do ciclo
  // anterior, que podem estar no meio de um await agora mesmo (uma
  // detecção, um POST). Ver `generation` lá em cima.
  generation++
  // Derruba o POST que estiver em voo e arma um controller limpo pro
  // ciclo seguinte (o `stopGameDetection` reporta o `null` logo depois
  // deste stop, e precisa de um signal válido).
  reportAbort.abort()
  reportAbort = new AbortController()
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  currentCycle = null
  lastReported = undefined
  lastReportedAt = 0
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
// Não dá pra só esperar o polling chegar: ele deduplica por VALOR
// (`lastReported`), e depois de um restart o valor não mudou. Por isso
// aqui o dedupe é derrubado — mas SEM abrir um caminho de report
// paralelo, que era o jeito antigo (um `reportNowPlayingWithRetry`
// avulso correndo junto do polling) e uma fonte de corrida por si só.
// Agora só antecipa a passada que já estava agendada.
//
// O heartbeat do `reportNowPlaying` (REASSERT_INTERVAL_MS) cobre o mesmo
// buraco sozinho, com até um minuto de atraso; isto aqui é o atalho pro
// caso em que o app SABE que algo aconteceu.
export function resendNowPlayingAfterReconnect(): void {
  // `undefined` = nada reportado ainda; `null` = reportado como "sem
  // jogo", que é o padrão do servidor — em nenhum dos dois há o que
  // recuperar. Sem ciclo em pé, não há transmissão nenhuma.
  if (!activeRoomCode || !lastReported || !currentCycle) return

  lastReportedAt = 0

  // Sem timer armado = já tem uma passada em voo. Ela reagenda a próxima
  // sozinha ao terminar, e com o `lastReportedAt` zerado essa próxima já
  // reafirma. Nada a fazer aqui além de ter zerado.
  if (!pollTimer) return

  clearTimeout(pollTimer)
  pollTimer = null
  currentCycle()
}

// Chamado sempre que uma transmissão inicia ou troca de fonte (item 13,
// UpdateTransmissionModal), inclusive na troca automática de janela
// (gameWindowFollow.ts) — monta o ciclo de detecção+report pra fonte
// nova e o reinicia do zero, cobrindo trocar de monitor pra janela e
// vice-versa.
//
// Os dois modos rodam o MESMO ciclo desde 2026-09-24; o que muda entre
// eles é só a função de detecção e a existência de um fallback de nome.
export async function handleTransmissionSourceChanged(
  mainWindow: BrowserWindow,
  roomCode: string,
  captureArg: TransmissionSource
): Promise<void> {
  stopPollingOnly()
  // Depois do stop, que zera o estado do ciclo anterior e incrementa o
  // `generation` — o número que ESTA passada carrega daqui pra frente.
  const myGeneration = generation
  activeRoomCode = roomCode

  // Qual detector e qual fallback (ver detectorsForSource).
  const { detect, monitorFallback } = detectorsForSource(captureArg)

  // UMA PASSADA POR VEZ, encadeada por setTimeout em vez de setInterval
  // (2026-09-24). Duas coisas saem de graça dessa forma:
  //
  //   - nunca existem dois POSTs em voo pra mesma sala, então não há
  //     ordem de chegada pra dar errado. Antes o fallback de monitor
  //     saía sem await junto da primeira detecção, e o fallback chegando
  //     DEPOIS do jogo deixava o tile preso em "Screen 1" pelo resto da
  //     live — localmente o app achava que já tinha reportado o jogo, e
  //     o dedupe calava todos os ticks seguintes;
  //   - o retry deixa de ter teto. Antes eram 6 tentativas de 1,5s:
  //     passou disso, o modo JANELA (que não tinha polling nenhum)
  //     perdia a informação pra sempre. Agora um report que não cola só
  //     adianta a passada seguinte.
  // Falhas seguidas de report neste ciclo — só pra decidir entre o
  // intervalo curto e o normal, ver FAST_RETRY_ATTEMPTS.
  let consecutiveFailures = 0

  const runCycle = (): void => {
    void (async () => {
      if (generation !== myGeneration) return
      let nextDelay = POLL_INTERVAL_MS
      try {
        const info = (await detect()) ?? monitorFallback
        // Uma troca de fonte pode ter acontecido durante a detecção.
        if (generation !== myGeneration) return
        const ok = await reportNowPlaying(mainWindow, roomCode, info, myGeneration)
        consecutiveFailures = ok ? 0 : consecutiveFailures + 1
        if (!ok && consecutiveFailures <= FAST_RETRY_ATTEMPTS) nextDelay = RETRY_DELAY_MS
      } catch (err) {
        console.error(`Erro ao detectar/reportar jogo/janela da sala ${roomCode}:`, err)
      }
      // O ciclo não pode parar por causa de uma passada que deu errado:
      // reagenda sempre, e é isso que garante a segunda chance de
      // entrega até a transmissão acabar.
      if (generation !== myGeneration) return
      pollTimer = setTimeout(runCycle, nextDelay)
    })()
  }
  currentCycle = runCycle

  // Pedido do usuário (2026-09-03): reporta o fallback do monitor JÁ, sem
  // esperar a detecção terminar (Steam/tasklist, ~1s) — o título (AO
  // VIVO/código) já aparece assim que a sala é criada, então o subtítulo
  // ficava vazio por um instante até a primeira detecção resolver.
  //
  // COM await desde 2026-09-24 (era fire-and-forget): o custo de esperar
  // é uma ida e volta de HTTP, o da corrida era o tile travar no nome do
  // monitor pelo resto da live. Ver o comentário do `runCycle`.
  if (monitorFallback) {
    await reportNowPlaying(mainWindow, roomCode, monitorFallback, myGeneration)
  }

  runCycle()
}

// Chamado ao parar a transmissão (gstreamer:stop) — limpa o polling E
// avisa a sala/host que não tem mais jogo/janela sendo exibido.
export async function stopGameDetection(
  mainWindow: BrowserWindow,
  roomCode: string | null
): Promise<void> {
  stopPollingOnly()
  // `generation` já foi incrementado pelo stop acima, então esta chamada
  // passa pelo guard — e qualquer passada do ciclo anterior que ainda
  // esteja em voo não passa, que é exatamente o que se quer aqui.
  if (roomCode) await reportNowPlaying(mainWindow, roomCode, null, generation)
}

// Usado no fechamento abrupto do app (stopForAppQuit, ver
// gstreamerCapture.ts) — só limpa o timer local, sem chamada de rede
// nenhuma (mesmo espírito do resto de stopForAppQuit: não travar o
// fechamento esperando o token-server responder; a sala inteira já está
// sendo derrubada de qualquer forma).
export function stopGameDetectionForAppQuit(): void {
  stopPollingOnly()
}
