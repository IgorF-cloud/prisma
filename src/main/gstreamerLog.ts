import { app } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'

// Build empacotado não tem console visível (rodado via .bat/duplo-clique,
// sem terminal anexado) — sem isso, os `console.log`/`console.error` do
// gstreamerCapture.ts/nativeCaptureTargets.ts se perdem, e não dá pra
// diagnosticar problemas relatados numa máquina remota (ex: tela preta no
// viewer com captura de janela, 2026-08-30). Grava tudo num arquivo
// simples, além do console (que ainda ajuda em `npm run dev`).
const LOG_PATH = join(app.getPath('userData'), 'gstreamer-debug.log')

export function logGstreamer(line: string): void {
  console.log(`[gstreamer] ${line}`)
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // Best-effort — um problema pra escrever o log nunca deve travar a
    // transmissão em si.
  }
}

export function getGstreamerLogPath(): string {
  return LOG_PATH
}
