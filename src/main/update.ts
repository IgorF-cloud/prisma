import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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

// Baixa o instalador pra uma pasta temporária, reportando o progresso
// (0–1) via onProgress, e confere o SHA-256 contra o que o servidor
// informou — se não bater, apaga o arquivo e lança (mais vale falhar alto
// do que instalar um .exe corrompido/incompleto).
async function downloadInstaller(
  info: UpdateInfo,
  onProgress: (progress: number) => void
): Promise<string> {
  cleanupOldInstallerTemps()

  const response = await fetch(`${API_BASE_URL}${info.url}`, {
    headers: { Authorization: authHeader() }
  })
  if (!response.ok || !response.body) {
    throw new Error(`Falha ao baixar a atualização (HTTP ${response.status}).`)
  }

  const tempDir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
  const filePath = join(tempDir, `PrismaSetup-${info.version}.exe`)

  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  const hash = createHash('sha256')
  const fileStream = createWriteStream(filePath)

  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      received += value.length
      await new Promise<void>((resolve, reject) => {
        fileStream.write(value, (err) => (err ? reject(err) : resolve()))
      })
      if (total > 0) onProgress(received / total)
    }
  } finally {
    await new Promise<void>((resolve) => fileStream.end(resolve))
  }

  const actualSha256 = hash.digest('hex')
  if (actualSha256.toLowerCase() !== info.sha256.toLowerCase()) {
    rmSync(filePath, { force: true })
    throw new Error('A verificação de integridade (SHA-256) da atualização falhou.')
  }

  return filePath
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

export function setupUpdateHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('update:check', () => checkForUpdate())

  ipcMain.handle('update:download', (_event, info: UpdateInfo) =>
    downloadInstaller(info, (progress) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:download-progress', progress)
      }
    })
  )

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
