import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, mkdtempSync, readdirSync, rmSync } from 'fs'
import { open, type FileHandle } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { API_BASE_URL } from './config'
import { authHeader } from './apiToken'

// Auto-atualização (mesmo espírito do app Flutter, ver lib/core/
// update_service.dart) — GET /version no token-server devolve a versão
// mais nova publicada + onde baixar o instalador + o SHA-256 esperado
// (ver version.json no servidor). O app confere isso uma vez ao abrir;
// se achar uma versão mais nova, mostra um diálogo (ver useAppUpdate.ts
// no renderer) oferecendo baixar+instalar.
export interface UpdateInfo {
  version: string
  url: string
  sha256: string
}

function parseVersion(version: string): number[] {
  return version
    .split('+')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

// Compara "major.minor.patch" (ignora sufixo tipo "+build") — true se
// `remote` for mais nova que `local`.
export function isNewerVersion(local: string, remote: string): boolean {
  const l = parseVersion(local)
  const r = parseVersion(remote)
  for (let i = 0; i < 3; i++) {
    const lv = l[i] ?? 0
    const rv = r[i] ?? 0
    if (rv !== lv) return rv > lv
  }
  return false
}

async function fetchLatestVersionInfo(): Promise<UpdateInfo> {
  const response = await fetch(`${API_BASE_URL}/version`, {
    headers: { Authorization: authHeader() }
  })
  if (!response.ok) {
    throw new Error(`O servidor respondeu ${response.status} ao consultar a versão mais recente.`)
  }
  return (await response.json()) as UpdateInfo
}

const TEMP_PREFIX = 'prisma-update-'

// Apaga pastas de tentativas anteriores (o app se fecha logo depois de
// instalar, então nunca chega a limpar a própria) — best-effort, silencia
// qualquer erro (permissão, arquivo em uso etc.), só evita acumular lixo
// no TEMP.
function cleanupOldInstallerTemps(): void {
  try {
    const base = tmpdir()
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue
      try {
        rmSync(join(base, entry.name), { recursive: true, force: true })
      } catch {
        // ignora — não crítico
      }
    }
  } catch {
    // ignora — não crítico
  }
}

// QUANTAS CONEXÕES AO MESMO TEMPO (2026-09-21).
//
// Medido em produção neste dia: a banda até a VM é limitada POR FLUXO
// TCP, em ~1,6 Mbit/s (~200 KB/s). Não é limite do servidor nem da
// máquina de quem baixa — 8 conexões simultâneas deram ~200 KB/s CADA,
// crescimento perfeitamente linear. Numa conexão só, os ~100 MB do
// instalador levavam cerca de 9 minutos.
//
// Seis é o meio do caminho: corta o tempo pra ~1,5 minuto sem abrir um
// leque de conexões que pareça ataque ao próprio servidor. Se um dia o
// limite por fluxo sumir (troca de plano, CDN na frente), este número
// pode voltar a 1 sem mais nada mudar aqui.
const DOWNLOAD_PARTS = 6

// Abaixo disso, dividir só acrescenta requisições: o ganho de alguns
// segundos não paga o risco de uma das partes falhar.
const MIN_SIZE_FOR_PARTS = 8 * 1024 * 1024

// Quantas vezes uma parte tenta de novo antes de derrubar o download
// inteiro. A retomada continua de onde parou (o `Range` é recalculado a
// partir do que já foi gravado), então tentar de novo custa só o que
// falta daquele pedaço.
const PART_ATTEMPTS = 3

// Baixa UM pedaço do arquivo, gravando direto na posição dele dentro do
// .exe final. Os pedaços chegam fora de ordem e ao mesmo tempo — por
// isso `FileHandle.write` com posição explícita, e não um stream de
// escrita, que só sabe escrever no fim.
//
// Nada fica em memória além do chunk da vez: seis partes de ~17 MB
// bufferizadas seriam 100 MB de RAM pra nada.
async function downloadPart(
  url: string,
  handle: FileHandle,
  start: number,
  end: number,
  signal: AbortSignal,
  onBytes: (bytes: number) => void
): Promise<void> {
  // Avança conforme grava — é o que permite retomar no ponto certo
  // quando uma tentativa cai no meio.
  let position = start

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: authHeader(), Range: `bytes=${position}-${end}` },
        signal
      })
      // 206 e não um 2xx qualquer: um 200 aqui significa que o servidor
      // IGNOROU o Range e está mandando o arquivo inteiro — gravar isso
      // na posição do pedaço estragaria o arquivo em silêncio.
      if (response.status !== 206 || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await handle.write(value, 0, value.length, position)
        position += value.length
        onBytes(value.length)
      }

      // `end` é inclusivo. Terminar com posição menor quer dizer que a
      // conexão morreu sem erro antes do fim do pedaço — se isso passar
      // batido, o arquivo fica com um buraco de zeros e só o SHA-256
      // acusa, lá no fim.
      if (position <= end) throw new Error('a conexão terminou antes do fim do pedaço')
      return
    } catch (err) {
      // Cancelamento não é falha de rede: sair na hora, sem tentar de
      // novo, é o ponto inteiro do botão de cancelar.
      if (signal.aborted || attempt >= PART_ATTEMPTS) throw err
    }
  }
}

// Baixa o instalador pra uma pasta temporária, reportando o progresso
// (0–1) via onProgress, e confere o SHA-256 contra o que o servidor
// informou — se não bater, apaga o arquivo e lança (mais vale falhar alto
// do que instalar um .exe corrompido/incompleto).
//
// EM VÁRIAS CONEXÕES desde 2026-09-21 (ver DOWNLOAD_PARTS). O HEAD na
// frente serve pra decidir isso: sem `Accept-Ranges: bytes` ou sem
// tamanho conhecido, cai no caminho de sempre, de uma conexão só. O
// servidor de hoje anuncia os dois (é o `express.static` que cuida
// disso), mas um proxy no meio do caminho — uma CDN, por exemplo — pode
// não cuidar.
//
// O `signal` é o cancelar do usuário (botão no diálogo, 2026-09-21):
// abortado, o fetch derruba os streams, os `read()` lançam e o `finally`
// apaga a pasta temporária.
async function downloadInstaller(
  info: UpdateInfo,
  onProgress: (progress: number) => void,
  signal: AbortSignal
): Promise<string> {
  cleanupOldInstallerTemps()

  const url = `${API_BASE_URL}${info.url}`
  const head = await fetch(url, {
    method: 'HEAD',
    headers: { Authorization: authHeader() },
    signal
  })
  if (!head.ok) {
    throw new Error(`Falha ao baixar a atualização (HTTP ${head.status}).`)
  }

  const total = Number(head.headers.get('content-length') ?? 0)
  const acceptsRanges = (head.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes')

  const tempDir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  const filePath = join(tempDir, `PrismaSetup-${info.version}.exe`)

  // O progresso é a SOMA do que as partes gravaram — cada uma reporta o
  // seu chunk e nenhuma sabe da outra.
  let received = 0
  const report = (bytes: number): void => {
    received += bytes
    if (total > 0) onProgress(received / total)
  }

  let completed = false
  try {
    if (acceptsRanges && total >= MIN_SIZE_FOR_PARTS) {
      const handle = await open(filePath, 'w')
      try {
        // Fatias iguais, com a última levando o resto da divisão.
        const size = Math.ceil(total / DOWNLOAD_PARTS)
        const parts: Promise<void>[] = []
        for (let i = 0; i < DOWNLOAD_PARTS; i++) {
          const start = i * size
          if (start >= total) break
          const end = Math.min(start + size, total) - 1
          parts.push(downloadPart(url, handle, start, end, signal, report))
        }
        // `all` e não `allSettled`: se uma parte desistiu depois das
        // tentativas, o arquivo não tem como ficar completo — o erro
        // dela é o erro do download.
        await Promise.all(parts)
      } finally {
        await handle.close()
      }
    } else {
      // Caminho de sempre, de uma conexão só.
      const response = await fetch(url, { headers: { Authorization: authHeader() }, signal })
      if (!response.ok || !response.body) {
        throw new Error(`Falha ao baixar a atualização (HTTP ${response.status}).`)
      }
      const fileStream = createWriteStream(filePath)
      try {
        const reader = response.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          await new Promise<void>((resolve, reject) => {
            fileStream.write(value, (err) => (err ? reject(err) : resolve()))
          })
          report(value.length)
        }
      } finally {
        await new Promise<void>((resolve) => fileStream.end(resolve))
      }
    }

    // O hash sai do ARQUIVO PRONTO, e não dos bytes em trânsito como
    // antes: com as partes chegando fora de ordem, não existe um fio
    // único por onde passá-los na ordem certa. De quebra, isto confere o
    // que ficou no disco — que é o que o instalador vai rodar.
    const actualSha256 = await sha256OfFile(filePath)
    if (actualSha256 !== info.sha256.toLowerCase()) {
      throw new Error('A verificação de integridade (SHA-256) da atualização falhou.')
    }

    completed = true
    return filePath
  } finally {
    // Cancelado, erro de rede no meio do caminho ou hash que não bate: o
    // .exe pela metade não serve pra nada e ninguém volta nesta pasta —
    // apaga agora, em vez de deixar ~100 MB no TEMP até a próxima
    // atualização passar pelo cleanup lá em cima.
    if (!completed) rmSync(tempDir, { recursive: true, force: true })
  }
}

function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  return pipeline(createReadStream(filePath), hash).then(() => hash.digest('hex'))
}

// Roda o instalador baixado em modo silencioso (/SILENT — sem telas do
// wizard, só a barra de progresso nativa do Inno Setup), já pedindo pra
// reabrir o app sozinho ao terminar (ver [Run] em installer/prisma.iss).
//
// O instalador exige admin (grava no PATH e instala o GStreamer se
// faltar) — rodar o .exe direto falharia com ERROR_ELEVATION_REQUIRED
// nesse caso, então passa pelo PowerShell com `Start-Process -Verb
// RunAs`, o jeito padrão do Windows de disparar o prompt do UAC a partir
// de um processo não elevado. Espera o PowerShell terminar (não é
// fire-and-forget) — é o que dá tempo de verdade pro usuário responder o
// UAC (e o SmartScreen, se o instalador não estiver assinado) antes do
// app se fechar sozinho.
function runInstallerElevated(installerPath: string): Promise<void> {
  const psCommand =
    `try { Start-Process -FilePath '${installerPath}' ` +
    `-ArgumentList '/SILENT','/CLOSEAPPLICATIONS','/RESTARTAPPLICATIONS' -Verb RunAs } ` +
    `catch { exit 1 }`

  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCommand],
      (error) => {
        if (error) {
          reject(
            new Error(
              'A instalação não foi iniciada — o Windows pode ter negado a permissão (UAC) ou ' +
                'bloqueado o instalador (SmartScreen, por não ser assinado digitalmente). Tente ' +
                'novamente e aprove os avisos do Windows.'
            )
          )
        } else {
          resolve()
        }
      }
    )
  })
}

export type UpdateCheckResult =
  | { available: true; info: UpdateInfo; currentVersion: string }
  | { available: false; currentVersion: string }

// A pergunta "tem atualização?" num lugar só (2026-09-20). Antes ela
// morava dentro do handler de IPC, e o único jeito de fazê-la era o
// renderer perguntar — o que acontecia uma vez, no login. Agora o app
// também descobre isso NO MEIO da sessão (o servidor avisa por
// WebSocket quando uma versão nova é publicada, ver rooms.ts), e os dois
// caminhos precisam responder exatamente a mesma coisa: quem decide se
// aparece o botão verde da titlebar é esta comparação, não duas.
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  // Silencioso de propósito: sem servidor ou erro de rede aqui não deve
  // incomodar o usuário logo ao abrir o app (mesmo espírito do
  // _checkForUpdate do app Flutter).
  try {
    const info = await fetchLatestVersionInfo()
    const currentVersion = app.getVersion()
    if (isNewerVersion(currentVersion, info.version)) {
      return { available: true, info, currentVersion }
    }
    return { available: false, currentVersion }
  } catch {
    return { available: false, currentVersion: app.getVersion() }
  }
}

// Refaz a checagem e empurra o resultado pro renderer, sem ninguém ter
// perguntado. Chamado quando o servidor anuncia uma publicação.
//
// Empurra o resultado INTEIRO, inclusive `available: false`: uma versão
// republicada mais antiga (rollback) precisa apagar o botão que uma
// publicação anterior acendeu, senão ele fica apontando pra uma
// atualização que não existe mais.
export async function notifyUpdateAvailability(mainWindow: BrowserWindow): Promise<void> {
  const result = await checkForUpdate()
  if (mainWindow.isDestroyed()) return
  mainWindow.webContents.send('update:availability', result)
}

// O download em andamento, pra que o `update:cancel` tenha o que abortar
// (2026-09-21). Um de cada vez: o diálogo é modal, não há como pedir
// dois — mas se acontecer, o novo aborta o anterior em vez de deixar
// dois downloads de ~100 MB disputando a banda.
let activeDownload: AbortController | null = null

export function setupUpdateHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('update:check', () => checkForUpdate())

  ipcMain.handle('update:download', async (_event, info: UpdateInfo) => {
    activeDownload?.abort()
    const controller = new AbortController()
    activeDownload = controller
    // Com seis conexões chegando ao mesmo tempo, avisar o renderer a
    // cada chunk daria dezenas de mensagens por segundo pra mover uma
    // barra que só mostra número inteiro. Meio por cento é mais fino do
    // que o olho pega e mais raro do que o chunk.
    let lastSent = -1
    try {
      return await downloadInstaller(
        info,
        (progress) => {
          if (progress < 1 && progress - lastSent < 0.005) return
          lastSent = progress
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update:download-progress', progress)
          }
        },
        controller.signal
      )
    } finally {
      if (activeDownload === controller) activeDownload = null
    }
  })

  // Cancelar o download (botão no diálogo). Não devolve erro se não
  // houver nada baixando: o clique pode chegar no exato momento em que o
  // download terminou, e reclamar disso não ajudaria ninguém. Quem sabe
  // o que fazer com a tela é o renderer (ver cancelDownload em
  // useAppUpdate.ts) — aqui só se derruba a conexão.
  ipcMain.handle('update:cancel', () => {
    activeDownload?.abort()
    activeDownload = null
  })

  ipcMain.handle('update:install', async (_event, installerPath: string) => {
    await runInstallerElevated(installerPath)
    // Pequena pausa só pra garantir que a UI teve tempo de mostrar
    // "instalando" antes do processo morrer — dispara o mesmo cleanup de
    // fechar o app normalmente (mata GStreamer + derruba sala/ingress,
    // ver stopForAppQuit em gstreamerCapture.ts, já ligado no evento
    // 'close' da janela), não precisa duplicar isso aqui.
    setTimeout(() => app.quit(), 500)
  })
}
