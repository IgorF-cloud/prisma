import { desktopCapturer, ipcMain } from 'electron'
import { listOpenWindowTitles } from './nativeCaptureTargets'
import { logGstreamer } from './gstreamerLog'

export interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnailDataUrl: string
  // Só preenchido pra fontes de tela — id do Display da Screen API do
  // Electron (screen.getAllDisplays()), usado pra resolver o HMONITOR
  // real do Windows na hora de montar o pipeline do GStreamer (ver
  // nativeCaptureTargets.ts). Vem vazio pra janelas.
  displayId: number | null
}

// Prefixo das fontes "extras" (ver abaixo) — sourceId sintético, sem
// correspondência nenhuma no desktopCapturer. resolveCaptureArg
// (gstreamerCapture.ts) reconhece esse prefixo e resolve a janela pelo
// TÍTULO embutido (mesmo caminho de resolveWindowTarget, re-resolvido na
// hora de transmitir — nunca confia no HWND de quando a lista foi
// montada, uma janela pode ter fechado/reaberto nesse meio tempo).
export const EXTRA_WINDOW_PREFIX = 'window-extra:'

// Terceira (e última) forma que um `sourceId` de janela pode ter, aqui
// junto das outras duas pra quem procurar "quais formatos existem"
// encontrar tudo num lugar só — mas ao contrário das outras duas, esta
// NUNCA sai da grade de seleção: só o próprio app produz, quando troca de
// janela sozinho dentro do mesmo jogo (2026-09-10, ver
// gameWindowFollow.ts).
//
// O que ela resolve: as outras duas apontam pra uma janela pelo TÍTULO, e
// título empata (cliente e jogo do mesmo título costumam ser parecidos).
// Quando quem escolhe é o app, ele escolhe um HWND específico e não pode
// aceitar "usei a primeira que casou".
export const WINDOW_HANDLE_PREFIX = 'window-handle:'

// Título da própria janela do app (ver src/renderer/index.html) — o
// desktopCapturer já exclui a própria janela da lista sozinho; o
// complemento abaixo (Get-Process) não sabe disso, então filtra à mão.
const OWN_WINDOW_TITLE = 'Prisma'

async function listSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 }
  })

  const result: CaptureSource[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
    displayId:
      source.display_id && Number.isFinite(Number(source.display_id))
        ? Number(source.display_id)
        : null
  }))

  // Pedido do usuário (2026-08-31): o desktopCapturer sozinho não lista
  // TODAS as janelas abertas (limitação conhecida do Chromium no
  // Windows — pula janelas minimizadas, em outra área de trabalho
  // virtual, ou apps em segundo plano/suspensos). Complementa com a
  // mesma enumeração via PowerShell que já resolve o HWND na hora de
  // transmitir (Get-Process, sem essas restrições) — só pras janelas
  // que o desktopCapturer não trouxe. Essas entram sem thumbnail (o
  // Get-Process não gera miniatura nenhuma; o renderer mostra um ícone
  // genérico no lugar, ver TransmissionScreen.tsx/
  // UpdateTransmissionModal.tsx).
  try {
    const knownTitles = new Set(
      result.filter((source) => source.type === 'window').map((source) => source.name)
    )
    const extraTitles = await listOpenWindowTitles()
    for (const title of extraTitles) {
      if (title === OWN_WINDOW_TITLE || knownTitles.has(title)) continue
      knownTitles.add(title)
      result.push({
        id: `${EXTRA_WINDOW_PREFIX}${encodeURIComponent(title)}`,
        name: title,
        type: 'window',
        thumbnailDataUrl: '',
        displayId: null
      })
    }
  } catch (err) {
    logGstreamer(`listSources: falha ao complementar via PowerShell: ${err}`)
  }

  return result
}

// Usado pela TransmissionScreen (itens 9/10/11 do roadmap) só pra montar
// a grade de thumbnails/nomes — a captura em si (via GStreamer) resolve o
// `sourceId` escolhido pro HMONITOR/HWND real do Windows por conta
// própria (ver gstreamerCapture.ts/nativeCaptureTargets.ts), sem
// depender de `getDisplayMedia`/`setDisplayMediaRequestHandler` do
// Chromium — removido em 2026-08-30 junto com o resto do caminho de
// captura via Chromium (ver MEMORIA.md).
export function setupScreenCapture(): void {
  ipcMain.handle('screenCapture:listSources', () => listSources())
}
