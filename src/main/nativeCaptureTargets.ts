import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { screen } from 'electron'
import { logGstreamer } from './gstreamerLog'

// GStreamer (d3d11screencapturesrc) aceita `monitor-handle` (HMONITOR) ou
// `window-handle` (HWND) — handles de verdade do Win32. O `desktopCapturer`
// do Electron só devolve IDs internos do Chromium (`screen:X:0`/`window:X:0`)
// que NÃO são HMONITOR/HWND reais (confirmado: a doc do Electron diz que o
// número em `window:X:0` é "gerado aleatoriamente", não um HWND). Esse
// módulo faz a ponte: roda PowerShell pra descobrir os handles reais do
// Windows e correlaciona com o que o Electron/desktopCapturer relatou.

// Roda o script via arquivo temporário (`-File`), não `-Command <string>`.
// O script tem aspas duplas e um bloco `Add-Type @" ... "@` (here-string)
// com código C# — smuggled através do escaping de argv do
// child_process/CreateProcess, isso corrompia o script (o PowerShell
// falhava ao parsear e não escrevia nada no stdout, aí o
// `JSON.parse('')` explodia com "Unexpected end of JSON input"). Um
// arquivo .ps1 de verdade não passa pelo escaping de linha de comando
// nenhuma, então não tem esse problema.
function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'prisma-ps-'))
    const scriptPath = join(dir, `${randomUUID()}.ps1`)
    // `[Console]::OutputEncoding` do PowerShell 5.1, quando o stdout é
    // redirecionado (nosso caso, via spawn/pipe — não um console de
    // verdade), usa a codepage ANSI do sistema por padrão, não UTF-8 —
    // qualquer texto com acento que passe por aqui (ex: título de janela
    // "Configurações" no WINDOW_SCRIPT) sai corrompido do outro lado.
    // Setar aqui, uma vez só, cobre TODOS os scripts que passam por essa
    // função (MONITOR_SCRIPT, WINDOW_SCRIPT, DISCORD_PID_SCRIPT).
    const scriptWithUtf8Output = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`
    writeFileSync(scriptPath, scriptWithUtf8Output, 'utf-8')

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (err) => {
      rmSync(dir, { recursive: true, force: true })
      reject(err)
    })
    child.on('close', (code) => {
      rmSync(dir, { recursive: true, force: true })
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || `powershell saiu com código ${code}`))
    })
  })
}

// `ConvertTo-Json` não escreve nada no stdout quando o que é canalizado
// pra ele é uma coleção vazia (ex: nenhuma janela com título encontrada)
// — sem essa checagem, `JSON.parse('')` explodiria de novo, só que por um
// motivo diferente do bug do escaping do -Command.
function parseJsonList<T>(output: string): T[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  const parsed: unknown = JSON.parse(trimmed)
  return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T]
}

interface MonitorInfo {
  HMonitor: number
  X: number
  Y: number
  Width: number
  Height: number
}

// MonitorFromPoint no centro de cada tela (flag 2 = MONITOR_DEFAULTTONEAREST)
// devolve o HMONITOR de verdade daquela tela — não depende de ordem de
// enumeração (diferente de um "monitor-index", que foi a causa de um bug
// não resolvido no app Flutter antigo quando a ordem do
// `[System.Windows.Forms.Screen]::AllScreens` não batia com a ordem que o
// GStreamer/DXGI esperava).
const MONITOR_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PrismaNativeMonitor {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
}
"@
$result = foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
  $cx = $s.Bounds.X + [int]($s.Bounds.Width / 2)
  $cy = $s.Bounds.Y + [int]($s.Bounds.Height / 2)
  $pt = New-Object PrismaNativeMonitor+POINT
  $pt.X = $cx
  $pt.Y = $cy
  $h = [PrismaNativeMonitor]::MonitorFromPoint($pt, 2)
  [PSCustomObject]@{
    HMonitor = $h.ToInt64()
    X = $s.Bounds.X
    Y = $s.Bounds.Y
    Width = $s.Bounds.Width
    Height = $s.Bounds.Height
  }
}
$result | ConvertTo-Json -Compress
`

// Tolerância pra casar as bounds — não usamos igualdade exata porque o
// PowerShell (processo separado) e o Electron podem arredondar/reportar a
// escala de DPI de forma levemente diferente em monitores não-100%.
const BOUNDS_TOLERANCE_PX = 4

// Resolve o HMONITOR real de um Display do Electron (screen.getAllDisplays()),
// cruzando as bounds relatadas pelo Electron (ajustadas pelo scaleFactor,
// já que Display.bounds vem em pixels "lógicos"/DIP) com as bounds
// reportadas pelo PowerShell (pixels físicos) — devolve null se não achar
// correspondência (ex: monitor desconectado entre a listagem e o início da
// transmissão). `displayId` pode vir `null` (o `display_id` do
// desktopCapturer vem vazio "em algumas plataformas", segundo a própria
// doc do Electron — visto na prática em 2026-08-30) — nesse caso, se só
// existir um monitor conectado, não tem ambiguidade nenhuma e usamos ele
// direto, sem precisar de correlação.
export async function resolveMonitorHandle(displayId: number | null): Promise<string | null> {
  const output = await runPowerShell(MONITOR_SCRIPT)
  const monitors = parseJsonList<MonitorInfo>(output)
  logGstreamer(`resolveMonitorHandle: monitores via PowerShell = ${JSON.stringify(monitors)}`)

  if (monitors.length === 0) {
    logGstreamer('resolveMonitorHandle: PowerShell não reportou nenhum monitor')
    return null
  }
  if (monitors.length === 1) return String(monitors[0].HMonitor)

  const displays = screen.getAllDisplays()
  logGstreamer(
    `resolveMonitorHandle: displayId=${displayId}, screen.getAllDisplays()=${JSON.stringify(
      displays.map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }))
    )}`
  )

  if (displayId === null) {
    logGstreamer('resolveMonitorHandle: display_id não disponível e há mais de 1 monitor')
    return null
  }

  const display = displays.find((d) => d.id === displayId)
  if (!display) {
    logGstreamer(`resolveMonitorHandle: nenhum Display do Electron com id=${displayId}`)
    return null
  }

  const scale = display.scaleFactor || 1
  const expectedX = display.bounds.x * scale
  const expectedY = display.bounds.y * scale
  const expectedWidth = display.bounds.width * scale
  const expectedHeight = display.bounds.height * scale
  logGstreamer(
    `resolveMonitorHandle: esperado (bounds×scaleFactor=${scale}) = ` +
      `X=${expectedX} Y=${expectedY} W=${expectedWidth} H=${expectedHeight}, tolerância=${BOUNDS_TOLERANCE_PX}px`
  )

  const match = monitors.find(
    (m) =>
      Math.abs(m.X - expectedX) <= BOUNDS_TOLERANCE_PX &&
      Math.abs(m.Y - expectedY) <= BOUNDS_TOLERANCE_PX &&
      Math.abs(m.Width - expectedWidth) <= BOUNDS_TOLERANCE_PX &&
      Math.abs(m.Height - expectedHeight) <= BOUNDS_TOLERANCE_PX
  )
  if (match) return String(match.HMonitor)

  // Fallback: a correspondência por bounds pode falhar se a suposição de
  // scaleFactor não bater (monitores com escalas de DPI diferentes entre
  // si, por exemplo) — nesse caso, se a QUANTIDADE de monitores bater dos
  // dois lados, casa por posição relativa (ordenado da esquerda pra
  // direita, depois de cima pra baixo). Não é perfeito (pode falhar em
  // arranjos verticais/empilhados), mas é melhor que falhar sempre.
  logGstreamer(
    'resolveMonitorHandle: nenhum monitor do PowerShell bateu por bounds, tentando por posição relativa'
  )
  if (monitors.length !== displays.length) {
    logGstreamer(
      `resolveMonitorHandle: quantidade de monitores não bate (PowerShell=${monitors.length}, Electron=${displays.length}) — desistindo`
    )
    return null
  }

  const sortedMonitors = [...monitors].sort((a, b) => a.X - b.X || a.Y - b.Y)
  const sortedDisplays = [...displays].sort(
    (a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y
  )
  const displayIndex = sortedDisplays.findIndex((d) => d.id === displayId)
  if (displayIndex === -1) return null

  const fallbackMatch = sortedMonitors[displayIndex]
  logGstreamer(
    `resolveMonitorHandle: casado por posição (índice ${displayIndex}) — HMonitor=${fallbackMatch.HMonitor}`
  )
  return String(fallbackMatch.HMonitor)
}

export interface WindowInfo {
  MainWindowTitle: string
  Handle: number
  Id: number
  // Item 29 do roadmap, pedido do usuário (2026-09-05): nome do processo
  // dono da janela (SEM extensão — é o que `Get-Process` devolve, ex:
  // "eldenring", não "eldenring.exe") — usado pra cruzar a janela
  // escolhida com a lista de jogos do Discord, ver gameDetection.ts.
  ProcessName: string
  // Caminho completo do executável (2026-09-06). Serve pra saber se a
  // janela escolhida é um jogo RODANDO PELA STEAM (caminho sob
  // \steamapps\) — o RunningAppID do registro é global, então sem essa
  // amarração transmitir uma janela do Chrome com um jogo Steam aberto
  // mostraria "Jogando: <jogo>", que está errado. Pode vir null: o
  // `Get-Process` não consegue ler o Path de processos protegidos/
  // elevados, e nesse caso a detecção via Steam simplesmente não se
  // aplica (cai no título da janela, que é o comportamento seguro).
  Path: string | null
}

const WINDOW_SCRIPT = `
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } |
  Select-Object MainWindowTitle, Id, ProcessName, @{Name='Path';Expression={$_.Path}}, @{Name='Handle';Expression={$_.MainWindowHandle.ToInt64()}} |
  ConvertTo-Json -Compress
`

// Resolve o HWND real de uma janela pelo título — é a mesma limitação já
// documentada no app Flutter antigo (os IDs do desktopCapturer não são
// HWNDs de verdade nesta plataforma). Casa pelo título exibido no
// `desktopCapturer` (que é o MainWindowTitle real da janela) — pode falhar
// se duas janelas tiverem o mesmo título, ou se o app tiver sido
// fechado/reaberto entre a seleção e o início da transmissão.
//
// Devolve também o PID (item 31 do roadmap: captura de janela específica
// isola o áudio dela via `loopback-mode=include-process-tree`, ver
// resolveAudioLoopbackArgs em gstreamerCapture.ts), o nome do processo e
// o caminho do executável (item 29, pra cruzar com a lista do Discord e
// com a Steam em gameDetection.ts) — tudo sai de graça do mesmo
// `Get-Process`, sem chamada extra nenhuma.
export interface WindowTarget {
  handle: string
  pid: number
  title: string
  processName: string
  processPath: string | null
}

function toWindowTarget(match: WindowInfo): WindowTarget {
  return {
    handle: String(match.Handle),
    pid: match.Id,
    title: match.MainWindowTitle ?? '',
    processName: match.ProcessName ?? '',
    processPath: match.Path ?? null
  }
}

export async function resolveWindowTarget(windowTitle: string): Promise<WindowTarget | null> {
  const windows = await listWindows()
  logGstreamer(
    `resolveWindowTarget: procurando título "${windowTitle}" entre ${JSON.stringify(windows)}`
  )

  const matches = windows.filter((w) => w.MainWindowTitle === windowTitle)
  if (matches.length > 1) {
    logGstreamer(
      `resolveWindowTarget: ${matches.length} janelas com o mesmo título — usando a primeira (${matches[0].Handle})`
    )
  }
  const match = matches[0]
  return match ? toWindowTarget(match) : null
}

// Contrapartida por HWND da função acima (2026-09-10, item 13 do roadmap
// — troca automática de janela dentro do mesmo jogo). Existe porque o
// casamento por TÍTULO não serve pra escolha feita pelo APP: cliente e
// jogo de um mesmo título costumam ter títulos parecidos (o LoL tem
// "League of Legends" e "League of Legends (TM) Client"), e o próprio
// `resolveWindowTarget` já loga que, empatando, pega a primeira. Quando
// quem escolhe é o app, ele escolhe um HWND específico e resolve por ele.
//
// Continua RE-ENUMERANDO em vez de confiar no handle guardado, pelos
// mesmos dois motivos de sempre: o Windows recicla HWND de janela morta,
// e o PID/caminho precisam vir junto (áudio via
// `loopback-target-pid`, detecção de jogo). O efeito colateral é o que
// interessa pra quem chama: não achar o handle É o sinal de que a janela
// morreu.
export async function resolveWindowByHandle(
  handle: string,
  maxAgeMs = 0
): Promise<WindowTarget | null> {
  const windows = await listWindows(maxAgeMs)
  const match = windows.find((w) => String(w.Handle) === handle)
  if (!match) {
    logGstreamer(`resolveWindowByHandle: handle ${handle} não está mais aberto`)
    return null
  }
  return toWindowTarget(match)
}

// Última enumeração, pro `maxAgeMs` de `listWindows` (2026-09-20).
let windowCache: { at: number; windows: WindowInfo[] } | null = null
// Enumeração em andamento. Duas chamadas simultâneas viram uma só — não
// é micro-otimização: cada uma custa um processo PowerShell inteiro, e
// elas acontecem mesmo (o tick do seguidor cai em cima de uma troca de
// fonte com facilidade).
let windowLookupInFlight: Promise<WindowInfo[]> | null = null

// Enumeração crua, uma chamada de PowerShell. Exportada porque o
// seguidor de janela (gameWindowFollow.ts) precisa varrer TODAS as
// janelas a cada tick procurando uma "irmã" do mesmo jogo — as duas
// funções acima só respondem sobre uma janela específica.
//
// `maxAgeMs` aceita uma enumeração RECENTE em vez de fazer outra
// (2026-09-20). Medido nesta máquina, ociosa: 450-800ms por chamada. O
// caminho que mais doía era a troca de janela no fim de uma partida —
// `tryRecoverFromExit` enumera pra decidir pra onde voltar e, logo
// depois, `resolveCaptureArg` enumerava DE NOVO pra resolver o mesmo
// HWND que acabou de ser escolhido. Um segundo inteiro de live parada
// pra responder duas vezes a mesma pergunta, dentro de uma janela de
// tempo em que a sala está por um fio (ver HOSTLESS_RECONNECT_GRACE_MS
// no server.js).
//
// O padrão é `0` — enumerar de novo — porque a maioria das chamadas está
// justamente perguntando "esta janela AINDA existe?", e uma resposta
// velha responderia outra pergunta. Quem passa um valor aqui é quem sabe
// que acabou de perguntar.
export async function listWindows(maxAgeMs = 0): Promise<WindowInfo[]> {
  if (windowCache && maxAgeMs > 0 && Date.now() - windowCache.at <= maxAgeMs) {
    logGstreamer(
      `listWindows: reaproveitando a enumeração de ${Date.now() - windowCache.at}ms atrás`
    )
    return windowCache.windows
  }
  if (windowLookupInFlight) return windowLookupInFlight

  windowLookupInFlight = (async () => {
    try {
      const output = await runPowerShell(WINDOW_SCRIPT)
      const windows = parseJsonList<WindowInfo>(output)
      windowCache = { at: Date.now(), windows }
      return windows
    } finally {
      windowLookupInFlight = null
    }
  })()
  return windowLookupInFlight
}

// Pedido do usuário (2026-08-31): a lista de janelas da TransmissionScreen
// vinha só do `desktopCapturer` do próprio Electron, que no Windows tem
// limitações conhecidas — só lista janelas de nível superior com título
// visível, e pula janelas "cloaked" (minimizadas, em outra área de
// trabalho virtual, apps em segundo plano/suspensos). O `Get-Process`
// usado acima (resolveWindowTarget) não tem essas restrições — reaproveita
// o mesmo `WINDOW_SCRIPT` só pra listar os títulos (sem HWND/PID, que só
// importam na hora de resolver a janela ESCOLHIDA pra transmitir, ver
// screenCapture.ts pra como isso complementa a lista do desktopCapturer).
export async function listOpenWindowTitles(): Promise<string[]> {
  const windows = await listWindows()
  const titles = new Set(windows.map((w) => w.MainWindowTitle).filter((title) => title))
  return Array.from(titles)
}

// Nomes de processo dos canais do Discord — cobre a versão padrão e as
// variantes PTB/Canary/Dev que alguns usuários rodam em paralelo. Portado
// 1:1 do app Flutter (lib/core/window_enumerator.dart).
const DISCORD_PROCESS_NAMES = [
  'Discord.exe',
  'DiscordPTB.exe',
  'DiscordCanary.exe',
  'DiscordDevelopment.exe'
]

// Acha o PID do processo RAIZ do Discord, se estiver rodando — usado pra
// excluir automaticamente o áudio dele da captura de monitor inteiro
// (item 31 do roadmap), sem o usuário precisar escolher nada.
//
// O Discord (também é Electron) roda VÁRIOS processos chamados
// "Discord.exe" (principal, renderer, GPU, utilitário) — `Get-Process` só
// devolve todos eles, sem indicar qual é o principal, e
// `loopback-mode=exclude-process-tree` do GStreamer só exclui o PID alvo
// E SEUS FILHOS, não os ancestrais nem processos irmãos. Escolher um PID
// errado (um processo filho, por exemplo) deixa de fora o processo que
// realmente produz o áudio e a exclusão simplesmente não funciona (mesmo
// bug já resolvido no Flutter em 2026-08-26). Por isso usa
// `Get-CimInstance Win32_Process` (expõe ParentProcessId) pra achar o
// único processo entre eles cujo pai NÃO é outro processo do Discord —
// esse é o processo raiz de verdade.
const DISCORD_PID_SCRIPT = `
$procs = Get-CimInstance Win32_Process -Filter "${DISCORD_PROCESS_NAMES.map((name) => `Name='${name}'`).join(' or ')}"
if (-not $procs) { exit }
$ids = $procs | ForEach-Object { $_.ProcessId }
$root = $procs | Where-Object { $ids -notcontains $_.ParentProcessId } | Select-Object -First 1
if ($root) { $root.ProcessId }
`

export async function findDiscordPid(): Promise<number | null> {
  try {
    const output = (await runPowerShell(DISCORD_PID_SCRIPT)).trim()
    if (!output) return null
    const pid = Number(output)
    return Number.isFinite(pid) ? pid : null
  } catch (err) {
    logGstreamer(`findDiscordPid: erro ao rodar PowerShell: ${err}`)
    return null
  }
}
