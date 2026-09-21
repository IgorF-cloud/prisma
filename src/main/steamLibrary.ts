import { execFile } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

// Jogos da Steam que a lista do Discord NÃO conhece (2026-09-14, pedido
// do usuário).
//
// ---------------------------------------------------------------------
// O BURACO QUE ISTO FECHA
//
// O usuário jogou "SlashZero Demo" e o app mostrou "The Legend of Heroes:
// Trails from Zero". Os dois têm um executável chamado `zero.exe`, e o
// mapa da lista do Discord casa só pelo NOME DO ARQUIVO, ignorando a
// pasta.
//
// Pôr o AppID da Steam na frente (ver gameDetection.ts) resolve quando o
// jogo ESTÁ na lista. Demos, playtests e lançamentos recentes não estão —
// e aí não havia nada: o appid não resolvia nome nenhum e a detecção caía
// de volta no executável, errando de novo.
//
// A informação existe, e na própria máquina: a Steam mantém um
// `appmanifest_<appid>.acf` por jogo instalado, com o nome de exibição e
// a pasta. É de lá que este módulo lê.
//
// Sem rede, de propósito. A alternativa era a API da loja
// (store.steampowered.com/api/appdetails — o `fetchSteamGameName` que
// segue comentado no gameDetection.ts): resolveria qualquer appid, mas
// depende de a Steam estar respondendo e de o usuário estar online, pra
// devolver um nome que já está no disco dele.
// ---------------------------------------------------------------------
//
// O que NÃO vem daqui é a arte: o manifesto não tem imagem, então o jogo
// resolvido por este caminho aparece com o placeholder da Steam (ver
// NowPlayingArt.tsx) e o nome certo. Nome certo sem arte é melhor que
// arte do jogo errado.

export interface SteamGame {
  appId: number
  // Nome de exibição, igual ao que a Steam mostra na biblioteca.
  name: string
}

// Um jogo instalado não muda de nome nem de pasta enquanto o app está
// aberto. Vale pra `null` também: não adianta varrer as bibliotecas de
// novo a cada tick de 8s pra concluir a mesma coisa.
const byAppId = new Map<number, SteamGame | null>()
const byPath = new Map<string, SteamGame | null>()

// `steamapps` é o que amarra tudo: toda biblioteca da Steam tem essa
// pasta, e todo jogo instalado mora em `<lib>\steamapps\common\<pasta>`.
const STEAMAPPS = '\\steamapps\\'

function normalize(path: string): string {
  return path.replace(/\//g, '\\')
}

// Um .acf é um VDF: pares "chave" "valor", um por linha. Não vale trazer
// um parser de VDF pra ler dois campos — o formato não tem nada de
// ambíguo aqui, e a chave é única dentro do arquivo.
function readVdfValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`"${key}"\\s+"([^"]*)"`, 'i'))
  return match ? match[1] : null
}

async function parseManifest(manifestPath: string): Promise<{
  appId: number
  name: string
  installDir: string
} | null> {
  try {
    const content = await readFile(manifestPath, 'utf-8')
    const appId = Number.parseInt(readVdfValue(content, 'appid') ?? '', 10)
    const name = readVdfValue(content, 'name')
    const installDir = readVdfValue(content, 'installdir')
    if (!Number.isFinite(appId) || appId <= 0 || !name || !installDir) return null
    return { appId, name, installDir }
  } catch {
    return null
  }
}

// Onde a Steam está instalada. Mesma chave do RunningAppID, então é a
// mesma leitura barata via reg.exe (ver gameDetection.ts pro porquê de
// não ser PowerShell).
function readSteamPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null)
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i)
        // A Steam grava esse caminho com barras pra FRENTE
        // ("c:/program files (x86)/steam"), ao contrário do resto do
        // Windows — daí o normalize.
        resolve(match ? normalize(match[1].trim()) : null)
      }
    )
  })
}

// Todas as pastas `steamapps` da máquina: a da instalação principal mais
// as bibliotecas em outros discos, que o `libraryfolders.vdf` lista.
//
// Sem cache: é chamada só quando um appid desconhecido aparece, e o
// resultado de cada busca é que fica guardado.
async function listSteamAppsDirs(): Promise<string[]> {
  const steamPath = await readSteamPath()
  if (!steamPath) return []

  const mainDir = join(steamPath, 'steamapps')
  const dirs = [mainDir]

  try {
    const vdf = await readFile(join(mainDir, 'libraryfolders.vdf'), 'utf-8')
    // `"path"  "D:\\SteamLibrary"` — o VDF escapa as barras, daí o
    // replace duplo.
    for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) {
      const libraryDir = join(normalize(match[1].replace(/\\\\/g, '\\')), 'steamapps')
      // Comparação sem caixa: o registro devolve o caminho todo em
      // minúsculas e o VDF devolve "C:\Program Files (x86)\Steam" — a
      // MESMA pasta entraria duas vezes na lista, e seria varrida duas
      // vezes. Visto nesta máquina, não é hipótese.
      const repetida = dirs.some((dir) => dir.toLowerCase() === libraryDir.toLowerCase())
      if (!repetida) dirs.push(libraryDir)
    }
  } catch {
    // Sem o arquivo (instalação antiga, ou nenhuma biblioteca extra):
    // sobra a pasta principal, que já é o caso da maioria.
  }

  return dirs
}

// O jogo que a Steam diz estar rodando, quando a lista do Discord não
// conhece o appid. Procura o manifesto dele em todas as bibliotecas.
export async function findSteamGameByAppId(appId: number): Promise<SteamGame | null> {
  if (!Number.isFinite(appId) || appId <= 0) return null

  const cached = byAppId.get(appId)
  if (cached !== undefined) return cached

  let result: SteamGame | null = null
  for (const dir of await listSteamAppsDirs()) {
    const manifest = await parseManifest(join(dir, `appmanifest_${appId}.acf`))
    if (manifest) {
      result = { appId: manifest.appId, name: manifest.name }
      break
    }
  }

  byAppId.set(appId, result)
  return result
}

// O jogo dono de um EXECUTÁVEL, a partir do caminho dele.
//
// É o caminho mais exato que existe aqui, e o único que não depende do
// registro: `...\steamapps\common\<pasta>\jogo.exe` já diz a biblioteca E
// a pasta. Basta achar, ali mesmo, o manifesto cujo `installdir` é essa
// pasta — e ele dá o appid de volta, o que permite tentar a lista do
// Discord de novo (agora pelo appid certo, com arte).
//
// Por isso ele vem ANTES do RunningAppID na captura de JANELA: o registro
// diz o que a Steam lançou, este diz de quem é a janela que está sendo
// transmitida. São perguntas diferentes, e aqui só a segunda importa.
export async function findSteamGameByExePath(processPath: string): Promise<SteamGame | null> {
  const cached = byPath.get(processPath)
  if (cached !== undefined) return cached

  const path = normalize(processPath)
  const index = path.toLowerCase().indexOf(STEAMAPPS)
  if (index === -1) {
    byPath.set(processPath, null)
    return null
  }

  const steamAppsDir = path.slice(0, index + STEAMAPPS.length - 1)
  // A pasta do jogo é o segmento logo depois de `common\`.
  const afterCommon = path.slice(index + STEAMAPPS.length).split('\\')
  const installDir = afterCommon[0]?.toLowerCase() === 'common' ? afterCommon[1] : null

  let result: SteamGame | null = null
  if (installDir) {
    try {
      const files = await readdir(steamAppsDir)
      for (const file of files) {
        const nome = file.toLowerCase()
        // Tem que TERMINAR em .acf: uma instalação em andamento deixa um
        // `appmanifest_<id>.acf.<números>.tmp` ao lado, que é escrita
        // parcial. Visto nesta máquina durante um download.
        if (!nome.startsWith('appmanifest_') || !nome.endsWith('.acf')) continue
        const manifest = await parseManifest(join(steamAppsDir, file))
        if (manifest?.installDir.toLowerCase() === installDir.toLowerCase()) {
          result = { appId: manifest.appId, name: manifest.name }
          break
        }
      }
    } catch {
      // Biblioteca num disco que saiu, permissão negada. Cai pro nome da
      // pasta abaixo, que ainda é melhor que nada.
    }

    // Sem manifesto legível, o nome da PASTA é o último recurso. Ele é
    // pior que o nome de exibição ("SlashZero" em vez de "SlashZero
    // Demo"), mas continua sendo o jogo certo — que é o que o nome errado
    // de antes não era.
    if (!result) result = { appId: 0, name: installDir }
  }

  byPath.set(processPath, result)
  return result
}
