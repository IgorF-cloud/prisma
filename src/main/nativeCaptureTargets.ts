import { screen } from 'electron'
import { parseJsonList, runPowerShell } from './powershell'
import {
  enumerateSnapshot,
  enumerateWindows,
  NativeMonitor,
  NativeWindow
} from './windowEnumeration'
import { logGstreamer } from './gstreamerLog'

// GStreamer (d3d11screencapturesrc) aceita `monitor-handle` (HMONITOR) ou
// `window-handle` (HWND) — handles de verdade do Win32. O `desktopCapturer`
// do Electron só devolve IDs internos do Chromium (`screen:X:0`/`window:X:0`)
// que NÃO são HMONITOR/HWND reais — no caso do monitor, pelo menos (o
// número do `window:X:0` acabou sendo o HWND mesmo, ver
// `handleFromDesktopCapturerId` em screenCapture.ts). Esse módulo faz a
// ponte: a enumeração nativa responde as duas coisas
// (windowEnumeration.ts) e este módulo correlaciona com o que o
// desktopCapturer relatou.
//
// O HMONITOR vinha de um script de PowerShell até 2026-10-13 — 550ms
// medidos, quase todos de overhead (o `powershell.exe` sozinho custa
// 333ms, e o `Add-Type` que compila o C# embutido, mais 200ms). O helper
// nativo responde isso junto das janelas, sem custo perceptível. O script
// continua aqui como degrau de baixo: ele é o que responde quando o
// helper não está lá ou é de uma versão anterior à mudança.

// O formato é o mesmo dos dois lados de propósito: o script de
// PowerShell abaixo foi escrito pra devolver exatamente o que o helper
// nativo devolve, pra que `resolveMonitorHandle` não precise saber de
// qual dos dois veio a resposta.
type MonitorInfo = NativeMonitor

// DEGRAU DE BAIXO desde 2026-10-13 (ver `resolveMonitorHandle`): só roda
// quando o helper nativo não respondeu as telas.
//
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
// As telas da máquina, do helper nativo quando ele sabe responder
// (2026-10-13) e do PowerShell quando não.
//
// `maxAgeMs` vale só pro caminho nativo, e existe pelo motivo de sempre:
// quem acabou de enumerar as janelas já tem as telas na mão, e pagar
// outro processo pra reler o que não muda seria desperdício. O degrau de
// PowerShell não tem cache — ele é o caminho raro.
async function listMonitors(maxAgeMs: number): Promise<MonitorInfo[]> {
  try {
    const { monitores } = await enumerateSnapshot(maxAgeMs)
    if (monitores) {
      logGstreamer(`listMonitors: telas pelo helper nativo = ${JSON.stringify(monitores)}`)
      return monitores
    }
    logGstreamer('listMonitors: helper nativo não respondeu as telas — indo de PowerShell')
  } catch (err) {
    logGstreamer(`listMonitors: helper nativo falhou (${err}) — indo de PowerShell`)
  }

  const output = await runPowerShell(MONITOR_SCRIPT)
  const monitors = parseJsonList<MonitorInfo>(output)
  logGstreamer(`listMonitors: telas via PowerShell = ${JSON.stringify(monitors)}`)
  return monitors
}

export async function resolveMonitorHandle(
  displayId: number | null,
  maxAgeMs = 0
): Promise<string | null> {
  const monitors = await listMonitors(maxAgeMs)

  if (monitors.length === 0) {
    logGstreamer('resolveMonitorHandle: nenhuma tela reportada')
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
  logGstreamer('resolveMonitorHandle: nenhuma tela bateu por bounds, tentando por posição relativa')
  if (monitors.length !== displays.length) {
    logGstreamer(
      `resolveMonitorHandle: quantidade de telas não bate (Windows=${monitors.length}, Electron=${displays.length}) — desistindo`
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

// A janela PRINCIPAL de um processo, no formato que o app usa desde o
// tempo em que a enumeração era um `Get-Process` (2026-09-05). Continua
// existindo porque o seguidor de janela e a resolução por título foram
// escritos sobre ele; o que mudou em 2026-09-25 é de onde os dados vêm
// (ver windowEnumeration.ts) e que agora isto é uma VISÃO da enumeração
// completa, não a enumeração inteira.
export interface WindowInfo {
  MainWindowTitle: string
  Handle: number
  Id: number
  // Nome do processo dono da janela, SEM extensão ("eldenring", não
  // "eldenring.exe") — usado pra cruzar a janela escolhida com a lista
  // de jogos do Discord, ver gameDetection.ts.
  ProcessName: string
  // Caminho completo do executável. Serve pra saber se a janela é um
  // jogo RODANDO PELA STEAM (caminho sob \steamapps\) — o RunningAppID
  // do registro é global, então sem essa amarração transmitir uma janela
  // do Chrome com um jogo Steam aberto mostraria "Jogando: <jogo>", que
  // está errado. Pode vir null: processos protegidos/elevados recusam a
  // leitura do caminho, e aí a detecção via Steam simplesmente não se
  // aplica (cai no título da janela, que é o comportamento seguro).
  Path: string | null
}

function toWindowInfo(janela: NativeWindow): WindowInfo {
  return {
    MainWindowTitle: janela.Title,
    Handle: janela.Handle,
    Id: janela.Pid,
    ProcessName: janela.ProcessName,
    Path: janela.Path || null
  }
}

// FileDescription do .exe quando ele existe e não é só o nome do arquivo
// — o mspaint declara "mspaint.exe" como FileDescription, e aí o
// ProductName ("Paint") é que é o nome do programa. Último recurso é o
// nome do processo, que sempre existe.
export function windowAppName(janela: NativeWindow): string {
  for (const candidato of [janela.Description, janela.Product]) {
    const limpo = (candidato ?? '').trim()
    if (limpo && !/\.exe$/i.test(limpo)) return limpo
  }
  return janela.ProcessName ?? ''
}

// Resolve o HWND real de uma janela pelo TÍTULO.
//
// Continua existindo pras fontes que não têm identidade exata: as
// "extras" da grade (ver EXTRA_WINDOW_PREFIX em screenCapture.ts) e o
// caminho de compatibilidade de quando a identificação por HWND não
// pega. Onde dá pra apontar um HWND, `resolveWindowByHandle` é melhor —
// título empata, HWND não.
//
// Procura entre as janelas PRINCIPAIS (a mesma lista de sempre), não
// entre todas: mudar o conjunto mudaria qual janela ganha um empate de
// título, e essa decisão é velha e estável.
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
  logGstreamer(`resolveWindowTarget: procurando título "${windowTitle}"`)

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
// "League of Legends" e "League of Legends (TM) Client"), e o
// `resolveWindowTarget` já loga que, empatando, pega a primeira.
//
// Continua RE-ENUMERANDO em vez de confiar no handle guardado, pelos
// mesmos dois motivos de sempre: o Windows recicla HWND de janela morta,
// e o PID/caminho precisam vir junto (áudio via `loopback-target-pid`,
// detecção de jogo). O efeito colateral é o que interessa pra quem
// chama: não achar o handle É o sinal de que a janela morreu.
//
// Procura na enumeração COMPLETA, não só nas principais — desde que a
// grade identifica cada card pelo HWND (2026-09-25), o handle pedido
// aqui pode ser uma janela secundária, como a segunda janela do Chrome.
export async function resolveWindowByHandle(
  handle: string,
  maxAgeMs = 0
): Promise<WindowTarget | null> {
  const janelas = await enumerateWindows(maxAgeMs)
  const match = janelas.find((janela) => String(janela.Handle) === handle)
  if (!match) {
    logGstreamer(`resolveWindowByHandle: handle ${handle} não está mais aberto`)
    return null
  }
  return toWindowTarget(toWindowInfo(match))
}

// As janelas PRINCIPAIS, uma por processo.
//
// É a visão que o seguidor de janela (gameWindowFollow.ts) e a resolução
// por título enxergam — a mesma de quando isto era um `Get-Process |
// Where MainWindowHandle -ne 0`. Ver `IsMain` em windowEnumeration.ts
// pra como esse "principal" é reproduzido.
//
// `maxAgeMs` aceita uma enumeração recente em vez de fazer outra; quem
// passa um valor aqui é quem sabe que acabou de perguntar.
export async function listWindows(maxAgeMs = 0): Promise<WindowInfo[]> {
  const janelas = await enumerateWindows(maxAgeMs)
  return janelas.filter((janela) => janela.IsMain && janela.Title).map(toWindowInfo)
}

// A enumeração indexada pelo HWND, que é como a grade pergunta
// (2026-09-30): pra cada card que o Chromium listou, o que mais se sabe
// daquela janela — o .exe dono dela, pro ícone e pro nome do programa.
//
// Substituiu a `listSelectableWindows`, que devolvia também as janelas
// fantasma pra grade poder descartá-las. A grade não filtra mais nada: o
// que o Chromium lista é o que aparece.
export async function windowsByHandle(): Promise<Map<string, NativeWindow>> {
  const janelas = await enumerateWindows()
  return new Map(janelas.map((janela) => [String(janela.Handle), janela]))
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

// DEGRAU DE BAIXO desde 2026-10-13 (ver `findDiscordPid`): o helper
// nativo responde isto de graça, e este script só roda quando ele não
// está disponível.
//
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

// Pelo helper nativo desde 2026-10-13 — ele já tira o snapshot de
// processos pra montar a árvore de ancestrais das janelas, e o raiz do
// Discord sai de lá sem custo nenhum. O `Get-CimInstance` abaixo custava
// 630ms medidos, pagos SEMPRE que a live é de monitor inteiro, bem no
// meio do caminho entre o clique e o pipeline subir.
//
// `maxAgeMs` importa aqui mais do que em qualquer outro lugar: quem
// chama é o `startPipeline`, logo depois de `resolveCaptureArg` ter
// enumerado tudo — com a leitura reaproveitada, a resposta é instantânea
// e o processo do helper roda uma vez só no start inteiro.
export async function findDiscordPid(maxAgeMs = 0): Promise<number | null> {
  try {
    const { monitores, discordPid } = await enumerateSnapshot(maxAgeMs)
    // `monitores` é o que distingue um helper que SABE responder isto de
    // um anterior à mudança — ver NativeSnapshot. Sabendo, `null` aqui é
    // resposta de verdade ("o Discord não está aberto"), e não falta de
    // resposta.
    if (monitores) return discordPid
    logGstreamer('findDiscordPid: helper nativo não responde o Discord — indo de PowerShell')
  } catch (err) {
    logGstreamer(`findDiscordPid: helper nativo falhou (${err}) — indo de PowerShell`)
  }

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
