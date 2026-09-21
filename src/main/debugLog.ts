import { app } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'

// Log de diagnóstico temporário (2026-08-31) — pra rastrear um bug
// relatado: sala do USER2 não aparecia em tempo real pra USER1, e depois
// de USER1 parar a própria transmissão, a PRÓPRIA sala dele reaparecia
// na lista (ver ROADMAP.md, nota no item 18). O app empacotado não tem
// terminal visível pra `console.log` do main process, então isso também
// grava num arquivo em `userData` — pode remover essa dependência (e as
// chamadas de logEvent) depois que o bug for confirmado/corrigido.
const LOG_FILE = join(app.getPath('userData'), 'debug.log')

export function logEvent(scope: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${scope}] ${message}`
  console.log(line)
  try {
    appendFileSync(LOG_FILE, line + '\n')
  } catch (err) {
    console.error('Erro ao escrever debug.log:', err)
  }
}

export function debugLogPath(): string {
  return LOG_FILE
}
