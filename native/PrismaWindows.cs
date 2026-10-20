// Enumerador de janelas do Windows — o mesmo trabalho que o app fazia
// via PowerShell, num executável de ~9 KB.
//
// Por que existe (2026-09-25, pedido do usuário): a grade de seleção de
// fonte precisa de duas coisas que o `desktopCapturer` do Electron não
// dá — as janelas que ele não lista (minimizadas, em outra área de
// trabalho) e a identidade/metadados de cada janela. Isso vinha de dois
// scripts de PowerShell, e o custo era quase todo overhead: medido nesta
// máquina, `powershell.exe` sem fazer nada nenhum já custa 333ms, e
// compilar o C# embutido (`Add-Type`) mais 200ms. O trabalho útil é uma
// fração disso. Aqui o mesmo resultado sai em ~85ms.
//
// O app NÃO depende deste executável: se ele não existir, não abrir ou
// devolver lixo, o caminho de PowerShell assume em silêncio (ver
// windowEnumeration.ts). Isso é de propósito — um antivírus barrando um
// .exe pequeno e não assinado que enumera janelas é um cenário real, e
// não pode virar um app travado.
//
// Compilado pelo build, não versionado: ver scripts/build-native-helper.mjs.
//
// A saída é UMA linha de JSON no stdout. O contrato está espelhado na
// interface `NativeWindow` (windowEnumeration.ts) e no script de
// PowerShell que faz as vezes dele — os três mudam juntos.
//
// TRÊS PERGUNTAS NUMA PASSADA SÓ (2026-10-13)
//
// O objeto que sai daqui responde `windows`, `monitors` e `discordPid`.
// Eram três processos antes: este, mais dois scripts de PowerShell em
// nativeCaptureTargets.ts. Medido nesta máquina, o preço daqueles dois
// era 550ms (o HMONITOR de cada tela, que ainda compila C# na hora com
// `Add-Type`) e 630ms (o PID raiz do Discord, via `Get-CimInstance`) —
// 1,2 segundo parado no caminho entre clicar em "iniciar transmissão" e
// o pipeline subir.
//
// Os dois saem praticamente de graça AQUI porque o trabalho já estava
// feito: as telas são um `EnumDisplayMonitors` (a mesma ordem de
// grandeza do EnumWindows que já roda), e o Discord sai do snapshot de
// processos que o `LoadParents` já tira pra montar a árvore de
// ancestrais. A chamada inteira continua custando os mesmos ~85ms.
//
// Antes desta data a saída era o ARRAY de janelas, sem embrulho. O lado
// do TypeScript ainda aceita aquele formato (ver windowEnumeration.ts):
// um .exe antigo numa árvore de desenvolvimento continua servindo a
// grade, e o PowerShell assume as outras duas perguntas.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class PrismaWindows
{
    private delegate bool EnumProc(IntPtr hwnd, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumProc callback, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);

    [DllImport("user32.dll")]
    private static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    // --- Telas (2026-10-13) -------------------------------------------
    //
    // O retângulo que o callback recebe (`lprcMonitor`) já é o que o app
    // precisa: posição e tamanho da tela em coordenadas da área de
    // trabalho virtual. Não precisa do `GetMonitorInfo` pra isso.
    //
    // O caminho de PowerShell que isto substitui perguntava por
    // `MonitorFromPoint` no centro de cada tela do
    // `System.Windows.Forms.Screen`. Dá no mesmo HMONITOR; o motivo
    // daquele desvio era que o PowerShell não recebe um callback de
    // enumeração sem compilar C# na hora — que é exatamente o que
    // custava os 200ms do `Add-Type`.
    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr dc, ref RECT rect, IntPtr param);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc callback, IntPtr param);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    // DPI: o lado do TypeScript compara estas bordas com as do Electron
    // MULTIPLICADAS pelo `scaleFactor`, ou seja, espera PIXEL FÍSICO (ver
    // `resolveMonitorHandle` em nativeCaptureTargets.ts). Um processo sem
    // consciência de DPI recebe do Windows bordas já esticadas pra escala
    // de 100%, e numa máquina a 125% a comparação erraria todas as telas
    // de uma vez.
    //
    // O PowerShell que isto substitui é um processo desses — o casamento
    // por bordas só funciona lá porque esta máquina roda a 100%.
    // Declarar a consciência conserta o caso escalado em vez de herdá-lo.
    //
    // `SetProcessDpiAwarenessContext` é do Windows 10 1607 em diante; o
    // `SetProcessDPIAware` atrás dele existe desde o Vista e resolve o
    // mesmo pro caso de uma tela só. Os dois podem falhar sem
    // consequência — nenhum é obrigatório pra enumerar janela.
    [DllImport("user32.dll")]
    private static extern IntPtr SetProcessDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

    [DllImport("kernel32.dll")]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageNameW(IntPtr proc, uint flags, StringBuilder path, ref int size);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public int th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public int th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    // O VirtualDesktopManager PÚBLICO (documentado no shobjidl_core.h),
    // não as interfaces internas do Explorer. `PreserveSig` não é
    // detalhe: sem ele o .NET transforma HRESULT de falha em exceção, e
    // a chamada morre antes de devolver qualquer coisa.
    [ComImport]
    [Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IVirtualDesktopManager
    {
        [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out bool onCurrentDesktop);
        [PreserveSig] int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);
        [PreserveSig] int MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
    }

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int DWMWA_CLOAKED = 14;
    private const uint TH32CS_SNAPPROCESS = 2;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 — um valor-sentinela,
    // não um ponteiro de verdade (é assim que a API é declarada).
    private static readonly IntPtr DPI_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

    // Os canais do Discord que existem. Portado do DISCORD_PROCESS_NAMES
    // do lado do TypeScript, SEM o ".exe": o `_names` guarda o nome como
    // o `Get-Process` devolvia, já sem extensão.
    private static readonly string[] DISCORD_NAMES = new string[]
    {
        "Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"
    };

    private static IVirtualDesktopManager _vdm;
    private static readonly Dictionary<int, int> _parents = new Dictionary<int, int>();
    // PID -> nome do executável SEM extensão ("chrome"), como o
    // `Get-Process` devolvia. Vem do Toolhelp32, e não do caminho da
    // imagem, porque o snapshot não precisa ABRIR o processo: jogo com
    // anti-cheat costuma recusar o OpenProcess, e é justamente o nome
    // dele que a detecção de jogo cruza com a lista do Discord (ver
    // gameDetection.ts).
    private static readonly Dictionary<int, string> _names = new Dictionary<int, string>();
    private static readonly Dictionary<int, string> _paths = new Dictionary<int, string>();
    // PID -> já viu a primeira janela dele? É assim que `IsMain` sai de
    // graça: ver o comentário em Collect().
    private static readonly HashSet<int> _seenPids = new HashSet<int>();

    // 1 sim, 0 não, -1 não deu pra saber. Todo caminho de erro devolve
    // -1, e quem consome trata -1 como "não filtre" — errar pra menos é
    // uma janela fantasma a mais na grade; errar pra mais é a janela do
    // usuário sumindo dela.
    private static int OnCurrentDesktop(IntPtr hwnd)
    {
        try
        {
            if (_vdm == null)
            {
                Type type = Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a"));
                _vdm = (IVirtualDesktopManager)Activator.CreateInstance(type);
            }
            bool onCurrent;
            if (_vdm.IsWindowOnCurrentVirtualDesktop(hwnd, out onCurrent) != 0) return -1;
            return onCurrent ? 1 : 0;
        }
        catch
        {
            return -1;
        }
    }

    // Árvore de processos via Toolhelp32. A alternativa óbvia seria
    // `Get-CimInstance Win32_Process`, que é o que o PowerShell usava —
    // e que sozinho custava 776ms medidos. Aqui sai junto com o resto.
    private static bool _parentsLoaded;

    private static void LoadParents()
    {
        // Chamado tanto pelo `Collect` quanto pelo `DiscordRootPid`, e o
        // snapshot de processos é a parte cara: uma vez por execução
        // basta, e os dois leem o mesmo instante da máquina.
        if (_parentsLoaded) return;
        _parentsLoaded = true;

        IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1)) return;
        try
        {
            PROCESSENTRY32 entry = new PROCESSENTRY32();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (!Process32FirstW(snapshot, ref entry)) return;
            do
            {
                _parents[entry.th32ProcessID] = entry.th32ParentProcessID;
                string exe = entry.szExeFile ?? "";
                if (exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    exe = exe.Substring(0, exe.Length - 4);
                }
                _names[entry.th32ProcessID] = exe;
            } while (Process32NextW(snapshot, ref entry));
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }

    // `PROCESS_QUERY_LIMITED_INFORMATION` (e não QUERY_INFORMATION) de
    // propósito: é o direito mínimo que responde o caminho da imagem, e
    // o único que funciona em processos protegidos/elevados sem o app
    // ser elevado. Mesmo assim pode falhar — aí o caminho fica vazio e
    // quem consome mostra o placeholder.
    private static string PathOf(int pid)
    {
        string cached;
        if (_paths.TryGetValue(pid, out cached)) return cached;

        string result = "";
        IntPtr proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (proc != IntPtr.Zero)
        {
            try
            {
                StringBuilder buffer = new StringBuilder(1024);
                int size = buffer.Capacity;
                if (QueryFullProcessImageNameW(proc, 0, buffer, ref size)) result = buffer.ToString();
            }
            finally
            {
                CloseHandle(proc);
            }
        }
        _paths[pid] = result;
        return result;
    }

    // FileDescription e ProductName do .exe — é daqui que sai o nome do
    // PROGRAMA ("Google Chrome"), que não é o título da janela
    // ("monster tier list - Pesquisa Google - Google Chrome").
    //
    // Os dois porque nenhum sozinho resolve: o mspaint declara
    // FileDescription "mspaint.exe" (e ProductName "Paint"), o HeidiSQL
    // não declara nada. Quem escolhe entre eles é o lado do TypeScript.
    private static readonly Dictionary<string, string[]> _versionInfo = new Dictionary<string, string[]>();

    private static string[] VersionInfoOf(string path)
    {
        if (path.Length == 0) return new string[] { "", "" };

        string[] cached;
        if (_versionInfo.TryGetValue(path, out cached)) return cached;

        string[] result = new string[] { "", "" };
        try
        {
            FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
            result = new string[] { info.FileDescription ?? "", info.ProductName ?? "" };
        }
        catch
        {
            // Caminho de rede que sumiu, arquivo sem version info. O nome
            // do processo serve de último recurso, do lado do TypeScript.
        }
        _versionInfo[path] = result;
        return result;
    }

    private static List<string> Collect()
    {
        LoadParents();
        List<string> rows = new List<string>();

        EnumWindows(delegate (IntPtr hwnd, IntPtr param)
        {
            if (!IsWindowVisible(hwnd)) return true;

            StringBuilder title = new StringBuilder(512);
            GetWindowTextW(hwnd, title, title.Capacity);
            if (title.Length == 0) return true;

            // Janela de ferramenta: sem botão na barra de tarefas, fora do
            // Alt-Tab. NÃO é filtrada aqui, é só sinalizada — o Chromium
            // lista essas, e precisamos reconhecê-las pra casar com o que
            // ele devolve. Quem decide o que fazer com elas é a grade.
            int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            bool toolWindow = (exStyle & WS_EX_TOOLWINDOW) != 0;

            // Camada que deixa o clique passar (2026-10-17): `LAYERED`
            // (pintada com transparência por pixel) + `TRANSPARENT` (o
            // mouse atravessa). É o desenho de uma sobreposição, não de
            // uma janela — o "Shell Handwriting Canvas" do teclado de
            // toque é uma dessas, do tamanho da tela. Também só
            // sinalizado; quem decide é a grade.
            bool clickThrough =
                (exStyle & WS_EX_LAYERED) != 0 && (exStyle & WS_EX_TRANSPARENT) != 0;

            int pid;
            GetWindowThreadProcessId(hwnd, out pid);

            // `IsMain` reproduz o `MainWindowHandle` do .NET/Get-Process:
            // a PRIMEIRA janela visível e com título que aparece pro
            // processo na ordem do EnumWindows. Não é aproximação — é
            // literalmente como o .NET o calcula.
            //
            // Existe porque o seguidor de janela (gameWindowFollow.ts)
            // sempre trabalhou sobre "uma janela por processo", e mudar
            // isso mudaria a decisão dele no meio de uma live. A grade
            // usa a lista inteira; o seguidor filtra por este campo e
            // continua vendo exatamente o que via antes.
            bool isMain = _seenPids.Add(pid);

            int cloaked;
            if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, sizeof(int)) != 0) cloaked = 0;

            StringBuilder className = new StringBuilder(256);
            GetClassNameW(hwnd, className, className.Capacity);

            List<int> ancestors = new List<int>();
            int current = pid;
            for (int depth = 0; depth < 8; depth++)
            {
                int parent;
                if (!_parents.TryGetValue(current, out parent)) break;
                if (parent == 0 || parent == current) break;
                ancestors.Add(parent);
                current = parent;
            }

            string path = PathOf(pid);
            string[] version = VersionInfoOf(path);
            string processName;
            if (!_names.TryGetValue(pid, out processName)) processName = "";

            StringBuilder row = new StringBuilder();
            row.Append("{\"Handle\":").Append(hwnd.ToInt64())
               .Append(",\"Pid\":").Append(pid)
               .Append(",\"ProcessName\":").Append(Quote(processName))
               .Append(",\"IsMain\":").Append(isMain ? "true" : "false")
               .Append(",\"Minimized\":").Append(IsIconic(hwnd) ? "true" : "false")
               .Append(",\"ToolWindow\":").Append(toolWindow ? "true" : "false")
               .Append(",\"ClickThrough\":").Append(clickThrough ? "true" : "false")
               .Append(",\"Cloaked\":").Append(cloaked)
               .Append(",\"OnCurrentDesktop\":").Append(OnCurrentDesktop(hwnd))
               .Append(",\"Ancestors\":[").Append(string.Join(",", ancestors.ConvertAll(x => x.ToString()).ToArray())).Append("]")
               .Append(",\"ClassName\":").Append(Quote(className.ToString()))
               .Append(",\"Path\":").Append(Quote(path))
               .Append(",\"Description\":").Append(Quote(version[0]))
               .Append(",\"Product\":").Append(Quote(version[1]))
               .Append(",\"Title\":").Append(Quote(title.ToString()))
               .Append("}");
            rows.Add(row.ToString());
            return true;
        }, IntPtr.Zero);

        return rows;
    }

    // As telas, pro GStreamer (2026-10-13).
    //
    // `d3d11screencapturesrc` só aceita `monitor-handle=<HMONITOR>`, e o
    // id que o `desktopCapturer` do Electron devolve pra uma tela NÃO é
    // o HMONITOR (diferente do caso de janela, onde é). Quem casa os dois
    // é o lado do TypeScript, pelas bordas — ver resolveMonitorHandle.
    private static List<string> Monitors()
    {
        List<string> rows = new List<string>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr monitor, IntPtr dc, ref RECT rect, IntPtr param)
        {
            StringBuilder row = new StringBuilder();
            row.Append("{\"HMonitor\":").Append(monitor.ToInt64())
               .Append(",\"X\":").Append(rect.Left)
               .Append(",\"Y\":").Append(rect.Top)
               .Append(",\"Width\":").Append(rect.Right - rect.Left)
               .Append(",\"Height\":").Append(rect.Bottom - rect.Top)
               .Append("}");
            rows.Add(row.ToString());
            return true;
        }, IntPtr.Zero);
        return rows;
    }

    // O processo RAIZ do Discord, se ele estiver aberto.
    //
    // Serve pra excluir o áudio dele da captura de monitor inteiro (item
    // 31 do roadmap). O Discord é Electron e roda vários processos de
    // mesmo nome (principal, renderer, GPU, utilitário); o
    // `loopback-mode=exclude-process-tree` do GStreamer exclui o PID alvo
    // E SEUS FILHOS, nunca os ancestrais — apontar um filho faz a
    // exclusão simplesmente não acontecer (mesmo bug já resolvido no app
    // Flutter em 2026-08-26).
    //
    // O raiz é o único entre eles cujo pai NÃO é outro processo do
    // Discord. É a mesma regra do `Get-CimInstance` que isto substitui,
    // só que lida do snapshot que o `LoadParents` já tirou.
    private static int DiscordRootPid()
    {
        LoadParents();

        List<int> discordPids = new List<int>();
        foreach (KeyValuePair<int, string> entry in _names)
        {
            foreach (string name in DISCORD_NAMES)
            {
                if (string.Equals(entry.Value, name, StringComparison.OrdinalIgnoreCase))
                {
                    discordPids.Add(entry.Key);
                    break;
                }
            }
        }

        foreach (int pid in discordPids)
        {
            int parent;
            if (!_parents.TryGetValue(pid, out parent)) return pid;
            if (!discordPids.Contains(parent)) return pid;
        }
        return 0;
    }

    private static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        foreach (char c in value)
        {
            if (c == '"' || c == '\\') result.Append('\\').Append(c);
            else if (c < 32) result.Append("\\u").Append(((int)c).ToString("x4"));
            else result.Append(c);
        }
        return result.Append("\"").ToString();
    }

    // Consciência de DPI, antes de qualquer pergunta ao Windows. Melhor
    // esforço dos dois lados: falhar aqui só devolve as bordas de tela
    // escaladas, que é exatamente o que o PowerShell devolvia.
    private static void DeclareDpiAwareness()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(DPI_PER_MONITOR_AWARE_V2) != IntPtr.Zero) return;
        }
        catch
        {
            // Windows anterior ao 10 1607: a função não existe no user32
            // e o .NET levanta EntryPointNotFoundException na primeira
            // chamada. O degrau de baixo cobre.
        }

        try
        {
            SetProcessDPIAware();
        }
        catch
        {
        }
    }

    public static int Main()
    {
        try
        {
            // UTF-8 no stdout: título de janela com acento sai corrompido
            // sem isto quando a saída é redirecionada (é o mesmo motivo do
            // `[Console]::OutputEncoding` no lado do PowerShell).
            Console.OutputEncoding = new UTF8Encoding(false);
            DeclareDpiAwareness();

            // A ordem importa só por um motivo: `Collect` é quem enche a
            // árvore de processos que o `DiscordRootPid` lê. Chamado
            // fora de ordem ele tiraria um snapshot próprio — correto,
            // mas pago duas vezes.
            string windows = string.Join(",", Collect().ToArray());
            string monitors = string.Join(",", Monitors().ToArray());
            int discord = DiscordRootPid();

            Console.Out.Write(
                "{\"windows\":[" + windows +
                "],\"monitors\":[" + monitors +
                "],\"discordPid\":" + (discord > 0 ? discord.ToString() : "null") +
                "}");
            return 0;
        }
        catch (Exception error)
        {
            // stderr, não stdout: quem chama distingue "deu ruim" de uma
            // lista vazia legítima (ver windowEnumeration.ts — falhar aqui
            // é erro, e a grade segue com o que o Chromium listou).
            Console.Error.Write(error.ToString());
            return 1;
        }
    }
}
