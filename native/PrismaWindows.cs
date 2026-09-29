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
    private const int DWMWA_CLOAKED = 14;
    private const uint TH32CS_SNAPPROCESS = 2;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

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
    private static void LoadParents()
    {
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
            bool toolWindow = (GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0;

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

    public static int Main()
    {
        try
        {
            // UTF-8 no stdout: título de janela com acento sai corrompido
            // sem isto quando a saída é redirecionada (é o mesmo motivo do
            // `[Console]::OutputEncoding` no lado do PowerShell).
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.Out.Write("[" + string.Join(",", Collect().ToArray()) + "]");
            return 0;
        }
        catch (Exception error)
        {
            // stderr, não stdout: quem chama distingue "deu ruim" de uma
            // lista vazia legítima, e cai no PowerShell.
            Console.Error.Write(error.ToString());
            return 1;
        }
    }
}
