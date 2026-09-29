import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import { parseJsonList, runPowerShell } from './powershell'
import { logGstreamer } from './gstreamerLog'

// TODA janela de topo do Windows, com o que o app precisa saber sobre
// cada uma (2026-09-25). Uma pergunta, uma resposta — antes eram dois
// scripts de PowerShell, e o custo apareceu na cara do usuário: a grade
// de seleção de fonte levava ~1,8s pra abrir.
//
// Dois caminhos produzem EXATAMENTE este formato:
//
//   1. o helper nativo (resources/prisma-windows.exe, ~9KB) — ~85ms
//   2. um script de PowerShell — ~800ms
//
// O (2) não é código morto nem "caso raro": é o que roda quando o
// executável não está lá (build sem ele, `npm run dev` antes do primeiro
// build) ou quando algo o impede de rodar — um antivírus barrando um
// .exe pequeno e sem assinatura que enumera janelas é cenário concreto.
// A troca é silenciosa de propósito: o usuário não tem o que fazer com
// esse aviso, e a única diferença que ele veria é a tela abrir mais
// devagar.
export interface NativeWindow {
  // HWND de verdade do Win32, o mesmo que o GStreamer aceita em
  // `window-handle`.
  Handle: number
  Pid: number
  // Nome do executável SEM extensão ("chrome"). Vem do snapshot de
  // processos, não do caminho da imagem: jogo com anti-cheat recusa o
  // OpenProcess, e é este nome que a detecção de jogo cruza com a lista
  // do Discord (ver gameDetection.ts).
  ProcessName: string
  // Esta é a janela que o `Get-Process` chamaria de `MainWindowHandle`
  // deste processo: a primeira visível e com título na ordem do
  // EnumWindows.
  //
  // Existe porque o seguidor de janela (gameWindowFollow.ts) sempre
  // trabalhou sobre "uma janela por processo" — ele filtra por este
  // campo e continua vendo o que via antes de esta enumeração existir.
  // A grade usa a lista inteira, e é isso que faz duas janelas do mesmo
  // Chrome virarem dois cards de verdade.
  IsMain: boolean
  Minimized: boolean
  // Janela de ferramenta (sem botão na barra de tarefas, fora do
  // Alt-Tab). Não é filtrada da enumeração porque o Chromium lista
  // essas e precisamos casar com o que ele devolve — a janela WebView2
  // que o WhatsApp abre é uma delas, e era a duplicata do WhatsApp na
  // grade. Quem decide o que fazer com ela é screenCapture.ts.
  ToolWindow: boolean
  // DWMWA_CLOAKED: janela que existe e tem título, mas que o DWM não
  // desenha — o estado de um app UWP suspenso em segundo plano. Ver
  // `isPhantomWindow` em nativeCaptureTargets.ts pro uso.
  Cloaked: number
  // 1 sim, 0 não, -1 não deu pra saber.
  OnCurrentDesktop: number
  // PIDs subindo a árvore de processos. Desempata título repetido: o
  // WhatsApp é um app WinUI que hospeda um WebView2, e os dois anunciam
  // uma janela "WhatsApp".
  Ancestors: number[]
  ClassName: string
  Path: string
  // FileDescription e ProductName do .exe — o nome do PROGRAMA, que não
  // é o título da janela. Podem vir vazios ou com lixo (o mspaint
  // declara FileDescription "mspaint.exe"); quem escolhe entre eles é
  // `windowAppName`.
  Description: string
  Product: string
  Title: string
}

// Onde o .exe pode estar, em ordem de probabilidade.
//
// Empacotado, o primeiro é O caminho: `asarUnpack: resources/**`
// (electron-builder.yml) tira o arquivo de dentro do app.asar e o põe em
// `app.asar.unpacked/`, preservando o caminho original — ou seja,
// `<resources>/app.asar.unpacked/resources/prisma-windows.exe`.
//
// Conferido na saída de um `build:unpack` de verdade, e não deduzido: a
// primeira versão disto chutou `<resources>/prisma-windows.exe` e não
// casava com nada. Como a falha é silenciosa por desenho, o sintoma
// seria uma release inteira rodando no caminho lento sem ninguém
// perceber — daí os candidatos extras abaixo, que cobrem o arquivo ter
// virado `extraResources` ou ido pra beira do .exe numa mudança futura
// de empacotamento.
function helperCandidates(): string[] {
  if (app.isPackaged) {
    return [
      join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'prisma-windows.exe'),
      join(process.resourcesPath, 'resources', 'prisma-windows.exe'),
      join(process.resourcesPath, 'prisma-windows.exe'),
      join(dirname(process.execPath), 'resources', 'prisma-windows.exe')
    ]
  }
  return [join(app.getAppPath(), 'resources', 'prisma-windows.exe')]
}

// Depois que o helper falha uma vez, não se tenta de novo nesta sessão.
// O motivo de uma falha (antivírus, permissão, arquivo ausente) não muda
// de uma chamada pra outra, e insistir custaria o timeout inteiro a cada
// vez — justamente no caminho que existe pra ser rápido.
let helperDesistiu = false

// Teto pro helper. Ele leva ~85ms; se passar disto, alguma coisa está
// segurando o processo (um antivírus inspecionando o binário é o caso
// típico) e o PowerShell chega antes.
const HELPER_TIMEOUT_MS = 3000

function runHelper(exePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      exePath,
      [],
      {
        timeout: HELPER_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf-8'
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message))
        else resolve(stdout)
      }
    )
  })
}

async function enumerateViaHelper(): Promise<NativeWindow[] | null> {
  if (helperDesistiu) return null

  const exePath = helperCandidates().find((candidate) => existsSync(candidate))
  if (!exePath) {
    helperDesistiu = true
    logGstreamer('windowEnumeration: helper nativo não encontrado — usando PowerShell')
    return null
  }

  try {
    const janelas = parseJsonList<NativeWindow>(await runHelper(exePath))
    // Lista vazia é suspeita: sempre existe ALGUMA janela de topo com
    // título (a do próprio app, no mínimo). Tratar como falha evita o
    // pior desfecho — uma grade vazia sem ninguém reclamar.
    if (janelas.length === 0) throw new Error('devolveu lista vazia')
    return janelas
  } catch (err) {
    helperDesistiu = true
    logGstreamer(
      `windowEnumeration: helper nativo falhou (${err}) — usando PowerShell desta vez em diante`
    )
    return null
  }
}

// O mesmo trabalho do helper, em PowerShell. É código duplicado de
// propósito: são dois caminhos independentes pro mesmo contrato, e o
// segundo só tem valor se não depender do primeiro.
//
// Mudou o contrato? Os três mudam juntos: `NativeWindow` aqui em cima,
// este script e native/PrismaWindows.cs.
const ENUMERATE_SCRIPT = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class PrismaEnum {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint f, uint p);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PROCESSENTRY32 e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct PROCESSENTRY32 {
    public uint dwSize; public uint cntUsage; public int th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID; public uint cntThreads; public int th32ParentProcessID; public int pcPriClassBase;
    public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string szExeFile;
  }
  [ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IVirtualDesktopManager {
    [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr w, out bool on);
    [PreserveSig] int GetWindowDesktopId(IntPtr w, out Guid id);
    [PreserveSig] int MoveWindowToDesktop(IntPtr w, ref Guid id);
  }
  static IVirtualDesktopManager vdm;
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowTextW(h, s, 512); return s.ToString(); }
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }
  public static int Pid(IntPtr h) { int p; GetWindowThreadProcessId(h, out p); return p; }
  public static int Cloaked(IntPtr h) { int v = 0; if (DwmGetWindowAttribute(h, 14, out v, 4) != 0) return 0; return v; }
  public static int OnCurrentDesktop(IntPtr h) {
    try {
      if (vdm == null) vdm = (IVirtualDesktopManager)Activator.CreateInstance(
        Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")));
      bool on; if (vdm.IsWindowOnCurrentVirtualDesktop(h, out on) != 0) return -1;
      return on ? 1 : 0;
    } catch { return -1; }
  }
  public static Dictionary<int,string> Names = new Dictionary<int,string>();
  public static Dictionary<int,int> Parents() {
    var d = new Dictionary<int,int>();
    IntPtr snap = CreateToolhelp32Snapshot(2, 0);
    if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return d;
    try {
      var e = new PROCESSENTRY32(); e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      if (Process32FirstW(snap, ref e)) do {
        d[e.th32ProcessID] = e.th32ParentProcessID;
        string exe = e.szExeFile == null ? "" : e.szExeFile;
        if (exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) exe = exe.Substring(0, exe.Length - 4);
        Names[e.th32ProcessID] = exe;
      } while (Process32NextW(snap, ref e));
    } finally { CloseHandle(snap); }
    return d;
  }
  public static List<IntPtr> Handles() {
    var l = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      if (Title(h).Length == 0) return true;
      l.Add(h); return true;
    }, IntPtr.Zero);
    return l;
  }
}
"@
$parents = [PrismaEnum]::Parents()
$procs = @{}
Get-Process | ForEach-Object { $procs[$_.Id] = $_ }
$vistos = @{}
$rows = foreach ($h in [PrismaEnum]::Handles()) {
  $wpid = [PrismaEnum]::Pid($h)
  $ehPrincipal = -not $vistos.ContainsKey($wpid)
  $vistos[$wpid] = $true
  $proc = $procs[$wpid]
  $cadeia = @()
  $cur = $wpid
  for ($i = 0; $i -lt 8; $i++) {
    if (-not $parents.ContainsKey($cur)) { break }
    $up = $parents[$cur]
    if ($up -eq 0 -or $up -eq $cur) { break }
    $cadeia += $up
    $cur = $up
  }
  [PSCustomObject]@{
    Handle = $h.ToInt64()
    Pid = $wpid
    ProcessName = $(if ([PrismaEnum]::Names.ContainsKey($wpid)) { [PrismaEnum]::Names[$wpid] } else { '' })
    IsMain = $ehPrincipal
    Minimized = [PrismaEnum]::IsIconic($h)
    ToolWindow = (([PrismaEnum]::GetWindowLong($h, -20) -band 128) -ne 0)
    Cloaked = [PrismaEnum]::Cloaked($h)
    OnCurrentDesktop = [PrismaEnum]::OnCurrentDesktop($h)
    Ancestors = @($cadeia)
    ClassName = [PrismaEnum]::Cls($h)
    Path = $(if ($proc -and $proc.Path) { $proc.Path } else { '' })
    Description = $(if ($proc -and $proc.Description) { $proc.Description } else { '' })
    Product = $(if ($proc -and $proc.Product) { $proc.Product } else { '' })
    Title = [PrismaEnum]::Title($h)
  }
}
$rows | ConvertTo-Json -Compress -Depth 4
`

async function enumerateViaPowerShell(): Promise<NativeWindow[]> {
  const janelas = parseJsonList<NativeWindow>(await runPowerShell(ENUMERATE_SCRIPT))
  // `ConvertTo-Json` entrega uma lista de um item como escalar.
  return janelas.map((janela) => ({
    ...janela,
    Ancestors: Array.isArray(janela.Ancestors)
      ? janela.Ancestors
      : janela.Ancestors == null
        ? []
        : [janela.Ancestors as unknown as number]
  }))
}

// Última enumeração e a que está em andamento — a mesma mecânica que
// `listWindows` tinha antes desta refatoração, e pelos mesmos motivos: o
// tick do seguidor cai em cima de uma troca de fonte com facilidade, e
// duas perguntas simultâneas não precisam virar dois processos.
let cache: { at: number; janelas: NativeWindow[] } | null = null
let emAndamento: Promise<NativeWindow[]> | null = null

// `maxAgeMs` aceita uma enumeração RECENTE em vez de fazer outra. O
// padrão é 0 — enumerar de novo — porque a maioria das chamadas está
// perguntando "esta janela AINDA existe?", e uma resposta velha
// responderia outra pergunta. Quem passa um valor aqui é quem sabe que
// acabou de perguntar.
export async function enumerateWindows(maxAgeMs = 0): Promise<NativeWindow[]> {
  if (cache && maxAgeMs > 0 && Date.now() - cache.at <= maxAgeMs) {
    logGstreamer(
      `enumerateWindows: reaproveitando a enumeração de ${Date.now() - cache.at}ms atrás`
    )
    return cache.janelas
  }
  if (emAndamento) return emAndamento

  emAndamento = (async () => {
    try {
      const janelas = (await enumerateViaHelper()) ?? (await enumerateViaPowerShell())
      cache = { at: Date.now(), janelas }
      return janelas
    } finally {
      emAndamento = null
    }
  })()
  return emAndamento
}
