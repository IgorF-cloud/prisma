import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Como o app roda um script de PowerShell e lê o JSON de volta.
//
// Sobraram DOIS usos, os dois em nativeCaptureTargets.ts: o HMONITOR de
// cada tela e o PID raiz do Discord. A enumeração de JANELAS também
// passava por aqui e saiu em 2026-09-30 — quem lista janela é o Chromium,
// e o que falta sobre elas vem do helper nativo (windowEnumeration.ts).

// Roda o script via arquivo temporário (`-File`), não `-Command <string>`.
// O script tem aspas duplas e um bloco `Add-Type @" ... "@` (here-string)
// com código C# — smuggled através do escaping de argv do
// child_process/CreateProcess, isso corrompia o script (o PowerShell
// falhava ao parsear e não escrevia nada no stdout, aí o
// `JSON.parse('')` explodia com "Unexpected end of JSON input"). Um
// arquivo .ps1 de verdade não passa pelo escaping de linha de comando
// nenhuma, então não tem esse problema.
export function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'prisma-ps-'))
    const scriptPath = join(dir, `${randomUUID()}.ps1`)
    // `[Console]::OutputEncoding` do PowerShell 5.1, quando o stdout é
    // redirecionado (nosso caso, via spawn/pipe — não um console de
    // verdade), usa a codepage ANSI do sistema por padrão, não UTF-8 —
    // qualquer texto com acento que passe por aqui sai corrompido do
    // outro lado. Setar aqui, uma vez só, cobre TODOS os scripts que
    // passam por essa função (MONITOR_SCRIPT, DISCORD_PID_SCRIPT).
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
// pra ele é uma coleção vazia (ex: nenhum monitor devolvido) — sem essa
// checagem, `JSON.parse('')` explodiria de novo, só que por um motivo
// diferente do bug do escaping do -Command.
export function parseJsonList<T>(output: string): T[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  const parsed: unknown = JSON.parse(trimmed)
  return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T]
}
