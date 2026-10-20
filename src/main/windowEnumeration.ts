import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import { logGstreamer } from './gstreamerLog'

// TODA janela de topo do Windows, com o que o app precisa saber sobre
// cada uma (2026-09-25).
//
// Quem decide QUAIS janelas aparecem na grade é o Chromium
// (desktopCapturer, ver screenCapture.ts) — esta enumeração não
// acrescenta nenhuma janela à lista dele desde 2026-09-30, a pedido do
// usuário, e também não tira nenhuma. O que ela faz é dizer o que o
// Chromium não sabe sobre as janelas que ele mesmo listou: o HWND de
// verdade (o único argumento que o GStreamer aceita) e o .exe dono da
// janela, de onde saem o ícone e o nome do programa.
//
// Vem do helper nativo (resources/prisma-windows.exe, ~12KB), em ~135ms.
// Havia um segundo caminho — o mesmo trabalho num script de PowerShell,
// ~800ms — que rodava quando o executável não estava lá; saiu em
// 2026-09-30 junto com o resto da busca de janelas via PowerShell. Sem o
// helper, a grade fica com o que o Chromium listou, sem ícone e sem nome
// do programa (ver `listSources` em screenCapture.ts).
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
  // A grade não filtra por ele: cada card do Chromium é casado pelo seu
  // próprio HWND, e é isso que faz duas janelas do mesmo Chrome virarem
  // dois cards de verdade.
  IsMain: boolean
  // Daqui até `ClassName`: campos que o helper escreve e que NINGUÉM lê
  // hoje. Estão aqui porque são o que o .exe devolve — o contrato com
  // native/PrismaWindows.cs — e porque descrevem a janela do jeito que a
  // grade precisaria se um dia voltar a filtrar alguma coisa. Filtrar é
  // justamente o que ela não faz mais desde 2026-09-30.
  Minimized: boolean
  // Janela de ferramenta (`WS_EX_TOOLWINDOW`): sem botão na barra de
  // tarefas, fora do Alt-Tab. O "Program Manager" do Explorer e a janela
  // WebView2 do WhatsApp são as duas desta máquina.
  ToolWindow: boolean
  // `WS_EX_LAYERED` + `WS_EX_TRANSPARENT` (2026-10-17): uma camada que o
  // mouse atravessa — sobreposição, não janela. O "Shell Handwriting
  // Canvas" do teclado de toque (TabTip.exe) é uma, do tamanho da tela.
  // Opcional porque um helper anterior a esta data não escreve o campo,
  // e aí ninguém é julgado por ele.
  ClickThrough?: boolean
  // DWMWA_CLOAKED: janela que existe e tem título, mas que o DWM não
  // desenha — o estado de um app UWP suspenso em segundo plano (o
  // "Configurações" era o caso). Cloaked + nesta área de trabalho =
  // fantasma; cloaked + em outra área = janela real, só que noutro lugar.
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

// Uma tela física, do jeito que o GStreamer precisa dela (2026-10-13).
//
// `d3d11screencapturesrc` só aceita `monitor-handle=<HMONITOR>`, e o id
// que o `desktopCapturer` devolve pra uma tela não é esse número (pra
// JANELA é — ver handleFromDesktopCapturerId em screenCapture.ts). Quem
// casa um com o outro, pelas bordas, é `resolveMonitorHandle`.
//
// X/Y/Width/Height em PIXEL FÍSICO: o helper declara consciência de DPI
// antes de perguntar (ver native/PrismaWindows.cs).
export interface NativeMonitor {
  HMonitor: number
  X: number
  Y: number
  Width: number
  Height: number
}

// Tudo o que uma execução do helper responde (2026-10-13).
//
// As três perguntas andam juntas porque o custo é a EXECUÇÃO, não o
// trabalho: 135ms pelo processo todo, contra os 550ms + 630ms que os
// dois scripts de PowerShell cobravam separados por responder as duas
// últimas. Ver o cabeçalho de native/PrismaWindows.cs.
export interface NativeSnapshot {
  janelas: NativeWindow[]
  // `null` quando o helper é de antes desta mudança (devolvia só o array
  // de janelas) — quem pergunta cai no PowerShell, que continua lá.
  monitores: NativeMonitor[] | null
  // `null` com dois sentidos DIFERENTES, e por isso `monitores` é que
  // decide: com `monitores` preenchido, null aqui é "o Discord não está
  // aberto"; com `monitores` null, é "este helper não sabe responder".
  discordPid: number | null
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
// casava com nada. Os candidatos extras abaixo cobrem o arquivo ter
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

// O JSON que o helper escreve, com os nomes DELE. É o contrato com
// native/PrismaWindows.cs e muda junto com ele — o resto do arquivo fala
// `janelas`/`monitores`, como o resto do app.
interface HelperOutput {
  windows: NativeWindow[]
  monitors?: NativeMonitor[]
  discordPid?: number | null
}

// Depois que o helper falha uma vez, não se tenta de novo nesta sessão:
// guarda-se O MOTIVO, e toda chamada seguinte falha na hora com ele. O
// motivo de uma falha (antivírus, permissão, arquivo ausente) não muda
// de uma chamada pra outra, e insistir custaria o timeout inteiro a cada
// vez — justamente no caminho que existe pra ser rápido.
let helperFalhou: string | null = null

// Teto pro helper. Ele leva ~85ms; se passar disto, alguma coisa está
// segurando o processo — um antivírus inspecionando um .exe pequeno e
// sem assinatura que enumera janelas é o caso típico.
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

// Falhar aqui é ERRO, não lista vazia: quem chama usa a AUSÊNCIA de uma
// janela como prova de que ela fechou (ver `resolveWindowByHandle`), e
// uma lista vazia por falha do helper derrubaria a live dizendo que a
// janela capturada morreu. Cada chamador trata isso do jeito dele — a
// grade fica com o que o Chromium listou, o seguidor de janela pula o
// tick.
async function enumerateViaHelper(): Promise<NativeSnapshot> {
  if (helperFalhou) throw new Error(helperFalhou)

  const exePath = helperCandidates().find((candidate) => existsSync(candidate))
  if (!exePath) {
    helperFalhou = 'helper nativo (prisma-windows.exe) não encontrado'
    logGstreamer(`windowEnumeration: ${helperFalhou}`)
    throw new Error(helperFalhou)
  }

  try {
    const bruto: unknown = JSON.parse((await runHelper(exePath)).trim())

    // DOIS FORMATOS ACEITOS (2026-10-13). O de hoje é um objeto com as
    // três respostas; o de antes era o array de janelas puro. Aceitar os
    // dois não é zelo decorativo: o .exe não é versionado (o build o
    // compila, ver scripts/build-native-helper.mjs), então uma árvore de
    // desenvolvimento com o binário antigo ao lado do código novo é o
    // caso NORMAL até alguém rodar `npm run build:native`. Com o antigo,
    // a grade funciona igual e as outras duas perguntas caem no
    // PowerShell.
    const snapshot: NativeSnapshot = Array.isArray(bruto)
      ? { janelas: bruto as NativeWindow[], monitores: null, discordPid: null }
      : {
          janelas: (bruto as HelperOutput).windows,
          monitores: (bruto as HelperOutput).monitors ?? null,
          discordPid: (bruto as HelperOutput).discordPid ?? null
        }

    // Lista vazia é suspeita: sempre existe ALGUMA janela de topo com
    // título (a do próprio app, no mínimo). Tratar como falha evita o
    // pior desfecho — uma grade inteira sem ícone sem ninguém reclamar.
    if (!snapshot.janelas || snapshot.janelas.length === 0) {
      throw new Error('devolveu lista vazia')
    }
    return snapshot
  } catch (err) {
    helperFalhou = `helper nativo falhou (${err})`
    logGstreamer(`windowEnumeration: ${helperFalhou} — desistindo dele nesta sessão`)
    throw new Error(helperFalhou)
  }
}

// Última enumeração e a que está em andamento — a mesma mecânica que
// `listWindows` tinha antes desta refatoração, e pelos mesmos motivos: o
// tick do seguidor cai em cima de uma troca de fonte com facilidade, e
// duas perguntas simultâneas não precisam virar dois processos.
let cache: { at: number; snapshot: NativeSnapshot } | null = null
let emAndamento: Promise<NativeSnapshot> | null = null

// TUDO O QUE O HELPER SABE, numa execução só (2026-10-13).
//
// `maxAgeMs` aceita uma leitura RECENTE em vez de fazer outra. O padrão é
// 0 — ler de novo — porque a maioria das chamadas está perguntando "esta
// janela AINDA existe?", e uma resposta velha responderia outra pergunta.
// Quem passa um valor aqui é quem sabe que acabou de perguntar.
export async function enumerateSnapshot(maxAgeMs = 0): Promise<NativeSnapshot> {
  if (cache && maxAgeMs > 0 && Date.now() - cache.at <= maxAgeMs) {
    logGstreamer(`enumerateSnapshot: reaproveitando a leitura de ${Date.now() - cache.at}ms atrás`)
    return cache.snapshot
  }
  if (emAndamento) return emAndamento

  emAndamento = (async () => {
    try {
      const snapshot = await enumerateViaHelper()
      cache = { at: Date.now(), snapshot }
      return snapshot
    } finally {
      emAndamento = null
    }
  })()
  return emAndamento
}

// Só as janelas, que é o que a maioria de quem chama quer.
export async function enumerateWindows(maxAgeMs = 0): Promise<NativeWindow[]> {
  return (await enumerateSnapshot(maxAgeMs)).janelas
}
