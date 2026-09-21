import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { API_BASE_URL } from './config'
import { authHeader } from './apiToken'

// Roadmap item 29 (detectar jogo em andamento): lista de jogos
// "detectáveis" do Discord (nome + executáveis Windows) — usada pra
// reconhecer jogos NÃO-Steam comparando contra os processos rodando (ver
// gameDetection.ts). O token-server já busca/cacheia/trima essa lista
// (GET /games/detectable, ver server.js do token_api); aqui só guarda uma
// cópia local em disco, refrescada a cada REFRESH_INTERVAL_DAYS dias, pra
// não precisar baixar de novo toda vez que o app abre.
export interface DetectableGame {
  name: string
  // Opcional desde 2026-09-06: 8.495 jogos da lista não têm executável
  // Windows nenhum e só são identificáveis pelo appid da Steam (era por
  // isso que o Forza Horizon 6 nunca aparecia — ver o comentário do trim
  // em server.js).
  executables?: string[]
  // appids da Steam desse jogo (`third_party_skus` com distributor
  // "steam"). Já filtrados pelo server pra só ids numéricos, então cada
  // appid aqui aponta pra exatamente um jogo.
  steamIds?: string[]
  // Pedido do usuário (2026-09-05): id do app + hash do ícone no CDN do
  // Discord, pra mostrar a arte do jogo no footer. Opcionais porque ~17%
  // dos apps da lista não têm ícone — o server só manda os dois campos
  // quando existem os DOIS (ver refreshDiscordGamesCache no server.js),
  // já que um sem o outro não monta URL nenhuma.
  id?: string
  icon?: string
}

// O que a detecção precisa saber sobre o jogo que casou — nome pra exibir
// e a arte (já como URL pronta, ou null quando o app não tem ícone na
// lista do Discord; nesse caso o footer usa o placeholder, ver
// HomeScreen.tsx).
export interface DetectedGame {
  name: string
  iconUrl: string | null
}

interface LocalGamesCache {
  downloadedAt: number
  games: DetectableGame[]
  // Versão do FORMATO do cache (não da lista) — ver CACHE_VERSION abaixo.
  version?: number
}

const CACHE_FILE = join(app.getPath('userData'), 'discordGames.json')

// A lista do Discord não muda tão rápido a ponto de precisar ser fresca
// todo dia — 3 dias equilibra "não ficar muito desatualizada" com "não
// baixar de novo toda hora à toa".
const REFRESH_INTERVAL_DAYS = 3
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000

// Versão do FORMATO do arquivo em disco, não da lista. Um cache gravado
// por uma versão anterior do app conta como velho mesmo estando dentro
// dos 3 dias — sem isso, quem já tinha a lista baixada ficaria até 3 dias
// sem os campos novos (id/icon, versão 2), com a arte do jogo sempre
// caindo no placeholder. Suba esse número toda vez que os campos de
// DetectableGame mudarem.
//
// v3 (2026-09-06): a v2 pegou uma armadilha de ORDEM DE DEPLOY. Quem
// abriu o app novo ANTES do token-server subir baixou uma lista sem
// id/icon e gravou "version: 2" nela — passando a valer como fresca por
// 3 dias, mesmo depois do server já estar servindo os ícones. A arte do
// jogo ficava no placeholder sem nada indicar o motivo. Subir a versão
// invalida esses caches meio-caminho na próxima abertura do app.
// v4 (2026-09-06): entrou o campo `steamIds` e o `executables` virou
// opcional — um cache v3 não tem como identificar jogo nenhum pela
// Steam, então precisa ser rebaixado.
const CACHE_VERSION = 4

let currentGames: DetectableGame[] = []
let exeToGameMap: Map<string, DetectedGame> | null = null
let steamIdToGameMap: Map<string, DetectedGame> | null = null

// https://cdn.discordapp.com/app-icons/<id>/<hash>.png — mesmo padrão que
// o próprio cliente do Discord usa. 256px é o suficiente pro maior uso
// atual (o quadrado do footer tem 42px de lado, mas telas em 2x/3x pedem
// mais que isso) e o CDN já entrega a versão redimensionada, não a
// original.
function buildIconUrl(game: DetectableGame): string | null {
  if (!game.id || !game.icon) return null
  return `https://cdn.discordapp.com/app-icons/${game.id}/${game.icon}.png?size=256`
}

function loadCacheFromDisk(): LocalGamesCache | null {
  if (!existsSync(CACHE_FILE)) return null
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as LocalGamesCache
  } catch (err) {
    console.error('Erro ao ler cache local da lista de jogos detectáveis:', err)
    return null
  }
}

function saveCacheToDisk(cache: LocalGamesCache): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Escreve num arquivo temporário e troca o nome depois (rename é
  // atômico no mesmo filesystem) — mesmo padrão de session.ts.
  const tmpFile = `${CACHE_FILE}.tmp`
  writeFileSync(tmpFile, JSON.stringify(cache))
  renameSync(tmpFile, CACHE_FILE)
}

function isStale(cache: LocalGamesCache): boolean {
  if (cache.version !== CACHE_VERSION) return true
  return Date.now() - cache.downloadedAt > REFRESH_INTERVAL_MS
}

function setActiveGames(games: DetectableGame[]): void {
  currentGames = games
  // Os dois reconstroem sob demanda na próxima chamada.
  exeToGameMap = null
  steamIdToGameMap = null
}

// Mapa invertido (executável minúsculo -> jogo), construído uma vez por
// lista carregada — o polling de detecção (a cada 8s, ver
// gameDetection.ts) só faz lookup O(1) por processo rodando, em vez de
// varrer a lista inteira de jogos a cada tick.
//
// CORREÇÃO (2026-09-05): 84,5% dos jogos da lista (8.831 de 10.449) eram
// INDETECTÁVEIS. O Discord grava a maioria dos executáveis com prefixo de
// caminho — "game/eldenring.exe", "win64/cs2.exe",
// "win64/valorant-win64-shipping.exe" — e as duas fontes de processo que
// usamos (`tasklist` pro monitor, `Get-Process` pra janela) só entregam o
// nome puro ("eldenring.exe"). Indexando só pela string inteira, nada
// disso batia: Elden Ring, CS2 e Valorant nunca foram detectados.
//
// A segunda passada abaixo indexa também pelo BASENAME, mas só quando ele
// é inequívoco — 410 dos 10.151 basenames (4%) aparecem em mais de um
// jogo, e o pior deles ("hl2.exe", 34 jogos de Source) daria um nome
// errado com confiança. Esses ambíguos ficam de fora e continuam se
// comportando como hoje (não detecta), em vez de chutar. Cobertura vai de
// ~15% pra ~96% sem nenhum falso positivo novo.
//
// A entrada EXATA sempre ganha do basename (primeira passada preenche
// primeiro, e a segunda só escreve onde ainda não tem nada).
export function getExeToGameMap(): Map<string, DetectedGame> {
  if (exeToGameMap) return exeToGameMap

  const map = new Map<string, DetectedGame>()
  const iconUrls = new Map<DetectableGame, string | null>()
  const detected = (game: DetectableGame): DetectedGame => {
    if (!iconUrls.has(game)) iconUrls.set(game, buildIconUrl(game))
    return { name: game.name, iconUrl: iconUrls.get(game) ?? null }
  }

  // 1ª passada: a string exata como veio da lista.
  for (const game of currentGames) {
    for (const exe of game.executables ?? []) {
      if (!map.has(exe)) map.set(exe, detected(game))
    }
  }

  // 2ª passada: quantos JOGOS DISTINTOS cada basename alcança. Conta por
  // nome de jogo (não por entrada) de propósito — o mesmo jogo listando
  // "win64/x.exe" e "win32/x.exe" não é ambiguidade nenhuma.
  const basenameOwners = new Map<string, Set<string>>()
  const basenameGame = new Map<string, DetectableGame>()
  for (const game of currentGames) {
    for (const exe of game.executables ?? []) {
      const base = basenameOf(exe)
      if (!base || base === exe) continue
      let owners = basenameOwners.get(base)
      if (!owners) {
        owners = new Set()
        basenameOwners.set(base, owners)
        basenameGame.set(base, game)
      }
      owners.add(game.name)
    }
  }

  for (const [base, owners] of basenameOwners) {
    if (owners.size !== 1 || map.has(base)) continue
    const game = basenameGame.get(base)
    if (game) map.set(base, detected(game))
  }

  exeToGameMap = map
  return exeToGameMap
}

// Açúcar em cima do mapa acima, extraído em 2026-09-10 quando o segundo
// chamador apareceu (gameWindowFollow.ts, além de gameDetection.ts). O
// que ele encapsula é a normalização, que é fácil de errar: o
// `Get-Process`/`tasklist` entrega o nome do processo SEM extensão
// ("leagueclientux"), e a lista do Discord indexa COM (".exe"). O
// `replace` protege contra a origem um dia mandar o nome já com
// extensão — sem ele viraria "leagueclientux.exe.exe" e nunca casaria.
export function findGameByProcessName(processName: string | undefined): DetectedGame | null {
  if (!processName) return null
  const exe = `${processName.toLowerCase().replace(/\.exe$/, '')}.exe`
  return getExeToGameMap().get(exe) ?? null
}

// Pedido do usuário (2026-09-06): identifica o jogo pelo appid que a
// Steam reporta estar rodando (RunningAppID no registro, ver
// gameDetection.ts). Nome e arte vêm da LISTA DO DISCORD, não da API da
// Steam — a lista já tem o ícone, então isso resolve as duas coisas de
// uma vez (a antiga `fetchSteamGameName`, que batia na loja da Steam, só
// trazia o nome e por isso segue desativada).
//
// Mapa simples, sem as duas passadas do `getExeToGameMap`: o server já
// garante que cada appid é numérico e aponta pra um único jogo (19.238
// appids, zero ambíguos), então não há o que desempatar aqui.
export function findGameBySteamId(appId: number): DetectedGame | null {
  if (!Number.isFinite(appId) || appId <= 0) return null

  if (!steamIdToGameMap) {
    const map = new Map<string, DetectedGame>()
    for (const game of currentGames) {
      for (const id of game.steamIds ?? []) {
        if (!map.has(id)) map.set(id, { name: game.name, iconUrl: buildIconUrl(game) })
      }
    }
    steamIdToGameMap = map
  }

  return steamIdToGameMap.get(String(appId)) ?? null
}

// "game/eldenring.exe" -> "eldenring.exe". O prefixo ">" aparece em umas
// poucas entradas da lista do Discord (ex: ">javaw.exe") e não faz parte
// do nome do arquivo — some junto.
function basenameOf(executable: string): string {
  const afterSlash = executable.split('/').pop() ?? executable
  return afterSlash.replace(/^>+/, '')
}

async function downloadList(onProgress: (progress: number) => void): Promise<DetectableGame[]> {
  const response = await fetch(`${API_BASE_URL}/games/detectable`, {
    headers: { Authorization: authHeader() }
  })
  if (!response.ok || !response.body) {
    throw new Error(`Falha ao baixar lista de jogos detectáveis (HTTP ${response.status}).`)
  }

  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  const chunks: Buffer[] = []
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    received += value.length
    if (total > 0) onProgress(received / total)
  }

  const data = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { games: DetectableGame[] }
  return data.games
}

// Chamado pelo renderer assim que o app abre (ver useDetectableGamesSync.ts)
// — se o cache local ainda estiver fresco, resolve na hora sem baixar nada
// (nenhum evento de progresso dispara, o overlay "Atualizando
// dependências..." nem chega a aparecer). Só baixa de novo (com progresso)
// quando o cache já passou de REFRESH_INTERVAL_DAYS dias ou nunca existiu.
export function setupGameDetectableCacheHandlers(mainWindow: BrowserWindow): void {
  // Carrega o que já tem em disco (se houver) logo de cara, mesmo antes do
  // renderer pedir — assim a detecção via processo já funciona com a
  // última lista conhecida enquanto/se um download novo falhar.
  const existing = loadCacheFromDisk()
  if (existing) setActiveGames(existing.games)

  ipcMain.handle('games:ensureDetectableList', async () => {
    const cache = loadCacheFromDisk()
    if (cache && !isStale(cache)) {
      setActiveGames(cache.games)
      return { downloaded: false as const }
    }

    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('games:list-download-start')
    try {
      const games = await downloadList((progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('games:list-download-progress', progress)
        }
      })
      saveCacheToDisk({ downloadedAt: Date.now(), games, version: CACHE_VERSION })
      setActiveGames(games)
      return { downloaded: true as const }
    } catch (err) {
      console.error(
        'Erro ao baixar lista de jogos detectáveis, usando cache anterior (se houver):',
        err
      )
      // Sem lista nova: segue com o que já tinha em disco (mesmo
      // desatualizado) — melhor detectar jogos com uma lista velha do que
      // não detectar nenhum.
      if (cache) setActiveGames(cache.games)
      return { downloaded: false as const, error: true as const }
    } finally {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('games:list-download-done')
    }
  })
}
