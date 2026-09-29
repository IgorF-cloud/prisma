import { desktopCapturer, ipcMain } from 'electron'
import { isHelperDuplicate, listSelectableWindows, windowAppName } from './nativeCaptureTargets'
import { NativeWindow } from './windowEnumeration'
import { getWindowIconDataUrl } from './windowIcon'
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
  // Os dois abaixo só valem pra fontes de JANELA e vêm do version info
  // do .exe dono dela — o `desktopCapturer` do Electron sozinho só sabe
  // o TÍTULO da janela, que é outra coisa ("monster tier list - Pesquisa
  // Google - Google Chrome" é o título; "Google Chrome" é o app).
  //
  // Podem vir null: processo protegido/elevado recusa a leitura do
  // caminho, e aí não há de onde tirar ícone. O renderer desenha o
  // placeholder nesse caso.
  appName: string | null
  // `data:image/png;base64,...` do ícone do PROGRAMA (não um screenshot
  // da janela) — mesmo caminho e mesmo cache do ícone que já vai no
  // broadcast da sala, ver windowIcon.ts.
  iconDataUrl: string | null
}

// Fonte de janela apontada pelo TÍTULO. Não é mais produzida desde
// 2026-09-25 (toda janela da grade tem HWND próprio agora — ver
// WINDOW_HANDLE_PREFIX), mas continua RECONHECIDA: o `sourceId` da
// última transmissão é guardado nas configurações, então um id antigo
// ainda pode chegar aqui depois de uma atualização do app.
export const EXTRA_WINDOW_PREFIX = 'window-extra:'

// Identidade EXATA de janela: um HWND de verdade do Windows. É a forma
// de TODA fonte de janela da grade desde 2026-09-25 — ver
// `handleFromDesktopCapturerId` abaixo pro porquê.
export const WINDOW_HANDLE_PREFIX = 'window-handle:'

// Título da própria janela do app (ver src/renderer/index.html) — o
// desktopCapturer já exclui a própria janela da lista sozinho; a
// enumeração nativa não sabe disso, então filtra à mão.
const OWN_WINDOW_TITLE = 'Prisma'

// O id de janela do desktopCapturer tem a forma `window:<n>:0`. Esse
// `<n>` É O HWND de verdade no Windows.
//
// Isso contraria a doc do Electron, que diz que o número é "gerado
// aleatoriamente" — e contrariava um comentário que existia aqui,
// escrito a partir da doc e não de um teste. Foi medido: rodando o
// Electron e o `EnumWindows` do Windows no mesmo instante, os números
// batem, com os títulos certos.
//
// Por que importa: sem isso, a única identidade de uma fonte de janela
// era o TÍTULO, e título empata. Duas janelas do Chrome com contas
// diferentes viravam dois cards que capturavam a MESMA janela.
//
// Nada disso é assumido às cegas: o HWND tem que aparecer na nossa
// enumeração E com o mesmo título. Não batendo, a fonte segue com o id
// original e cai no caminho por título, que é o de antes.
function handleFromDesktopCapturerId(sourceId: string): string | null {
  const match = /^window:(\d+):\d+$/.exec(sourceId)
  return match ? match[1] : null
}

async function listSources(): Promise<CaptureSource[]> {
  // As duas perguntas são INDEPENDENTES, e é isso que as deixa correr
  // juntas (2026-09-25). Antes a enumeração precisava dos HWNDs que o
  // desktopCapturer devolvia, então uma esperava a outra — com a
  // enumeração completa, ninguém espera ninguém.
  const [sources, selecionaveis] = await Promise.all([
    desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    }),
    listSelectableWindows().catch((err) => {
      // Sem a enumeração a grade ainda funciona: fica com o que o
      // Chromium listou, sem ícones e sem as janelas que ele não vê.
      logGstreamer(`listSources: enumeração de janelas falhou: ${err}`)
      return null
    })
  ])

  const result: CaptureSource[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
    displayId:
      source.display_id && Number.isFinite(Number(source.display_id))
        ? Number(source.display_id)
        : null,
    appName: null,
    iconDataUrl: null
  }))

  if (!selecionaveis) return result

  const { windows, phantomOnlyTitles, phantomHandles } = selecionaveis
  const porHandle = new Map(windows.map((janela) => [String(janela.Handle), janela]))

  // A janela por trás de cada card, quando deu pra confirmar qual é.
  // Chaveado pelo próprio objeto porque o `id` da fonte muda abaixo.
  const janelaDoCard = new Map<CaptureSource, NativeWindow>()

  // 1. Identidade exata por HWND.
  //
  //    O título confirma o ESQUEMA, não cada card. A diferença importa:
  //    conferir título por card parece mais rigoroso, mas castiga quem
  //    tem título que muda sozinho — a janela WebView2 do WhatsApp
  //    carrega o contador de não lidas ("(1) WhatsApp"), e entre a
  //    leitura do desktopCapturer e a nossa o número muda. Visto na
  //    prática: o card perdia ícone e identidade por causa disso.
  //
  //    Basta UM card resolver pro HWND certo com o título batendo pra
  //    provar que o número do id é mesmo o HWND — um número aleatório
  //    teria que coincidir com um handle vivo, e ainda por cima com o
  //    título dele. Provado o esquema, pros demais basta o HWND existir
  //    na enumeração. Se um dia o Electron mudar o formato, nada
  //    confirma, e tudo volta sozinho pro caminho por título.
  const esquemaConfirmado = result.some((source) => {
    if (source.type !== 'window') return false
    const handle = handleFromDesktopCapturerId(source.id)
    return handle ? porHandle.get(handle)?.Title === source.name : false
  })

  if (!esquemaConfirmado) {
    logGstreamer(
      'listSources: nenhum id do desktopCapturer bateu com um HWND conhecido — ' +
        'seguindo pelo caminho por título'
    )
  }

  for (const source of esquemaConfirmado ? result : []) {
    if (source.type !== 'window') continue
    const handle = handleFromDesktopCapturerId(source.id)
    const janela = handle ? porHandle.get(handle) : undefined
    if (!janela) continue
    janelaDoCard.set(source, janela)
    source.id = `${WINDOW_HANDLE_PREFIX}${handle}`
    // O título da NOSSA leitura, que é a mesma de onde vieram o ícone e
    // o nome do app — assim o card não mistura dois instantes.
    source.name = janela.Title
    source.appName = windowAppName(janela) || null
  }

  // 2. O que não é janela de app pra ninguém.
  //
  //    FANTASMA: existe pro Windows mas não está aberta de verdade — um
  //    app UWP suspenso em segundo plano ("Configurações" era o caso
  //    reclamado). O Chromium checa DWMWA_CLOAKED em algumas versões e
  //    não em outras, então filtrar só a nossa enumeração não bastaria:
  //    por HWND quando dá, por título como rede de segurança.
  //
  //    JANELA DE FERRAMENTA: `WS_EX_TOOLWINDOW` é o próprio Windows
  //    dizendo que aquilo não é uma janela principal — sem botão na
  //    barra de tarefas, fora do Alt-Tab. O Chromium lista essas assim
  //    mesmo, e era daí que vinha a segunda "WhatsApp" na grade: o app é
  //    WinUI e hospeda um WebView2, cuja janela é de ferramenta. Medido
  //    nesta máquina, as únicas duas na lista eram essa e o "Program
  //    Manager" (a área de trabalho do Explorer) — nenhuma janela de app
  //    de verdade é marcada assim.
  //
  //    Isto cobre o WhatsApp melhor que `isHelperDuplicate`, que exige
  //    título igual: a janela do WebView2 carrega o contador de não
  //    lidas ("(1) WhatsApp"), então o título nem sempre empata.
  for (let i = result.length - 1; i >= 0; i--) {
    const source = result[i]
    if (source.type !== 'window') continue
    const janela = janelaDoCard.get(source)
    if (janela?.ToolWindow) {
      logGstreamer(
        `listSources: descartando janela de ferramenta: "${source.name}" (${janela.ProcessName})`
      )
      janelaDoCard.delete(source)
      result.splice(i, 1)
      continue
    }
    const handle = handleFromDesktopCapturerId(source.id)
    const ehFantasma = handle
      ? phantomHandles.has(handle)
      : !janelaDoCard.has(source) && phantomOnlyTitles.has(source.name)
    if (!ehFantasma) continue
    logGstreamer(`listSources: descartando janela fantasma: "${source.name}"`)
    janelaDoCard.delete(source)
    result.splice(i, 1)
  }

  // 3. Janela auxiliar: mesmo título, processo DESCENDENTE do outro. O
  //    WhatsApp é um app WinUI que hospeda um WebView2, e os dois
  //    anunciam uma janela "WhatsApp". Ver `isHelperDuplicate` — a regra
  //    é estreita de propósito, porque duas janelas do mesmo processo
  //    (duas do Chrome) são janelas de verdade e não podem sumir.
  for (let i = result.length - 1; i >= 0; i--) {
    const filho = janelaDoCard.get(result[i])
    if (!filho) continue
    const pai = result.find((outro) => {
      const janela = janelaDoCard.get(outro)
      return janela && outro.name === result[i].name && isHelperDuplicate(janela, filho)
    })
    if (!pai) continue
    logGstreamer(
      `listSources: "${result[i].name}" (pid ${filho.Pid}) é janela auxiliar de ` +
        `pid ${janelaDoCard.get(pai)?.Pid} — descartada`
    )
    janelaDoCard.delete(result[i])
    result.splice(i, 1)
  }

  // 4. As janelas que o desktopCapturer não trouxe. O Chromium descarta
  //    de propósito as minimizadas e as cloaked — ele foi feito pra
  //    seletor de compartilhamento de tela, onde cada item precisa de
  //    uma miniatura viva, e janela minimizada não tem conteúdo pra
  //    miniatura. Medido: ele lista 5 de 13 aqui. Essas entram sem
  //    miniatura, e o renderer mostra o ícone do programa grande no
  //    lugar (ver CaptureSourceCard.tsx).
  const handlesCobertos = new Set([...janelaDoCard.values()].map((janela) => String(janela.Handle)))
  // Só as fontes que NÃO foram identificadas entram nesta checagem: uma
  // fonte identificada já está coberta pelo handle, e usar o título aqui
  // apagaria justamente a segunda janela de mesmo título.
  const titulosNaoIdentificados = new Set(
    result
      .filter((source) => source.type === 'window' && !janelaDoCard.has(source))
      .map((source) => source.name)
  )
  for (const janela of windows) {
    if (janela.Title === OWN_WINDOW_TITLE) continue
    // Mesma razão do passo 2 — e aqui o "Program Manager" do Explorer
    // (a área de trabalho) seria a entrada mais estranha da grade.
    if (janela.ToolWindow) continue
    if (handlesCobertos.has(String(janela.Handle))) continue
    if (titulosNaoIdentificados.has(janela.Title)) continue
    const source: CaptureSource = {
      id: `${WINDOW_HANDLE_PREFIX}${janela.Handle}`,
      name: janela.Title,
      type: 'window',
      thumbnailDataUrl: '',
      displayId: null,
      appName: windowAppName(janela) || null,
      iconDataUrl: null
    }
    result.push(source)
    janelaDoCard.set(source, janela)
  }

  // 5. Ícones, em paralelo. `getWindowIconDataUrl` é cacheado POR
  //    CAMINHO de executável, então N janelas do mesmo programa custam
  //    uma leitura só — e da segunda abertura da grade em diante não
  //    custam nenhuma.
  await Promise.all(
    [...janelaDoCard].map(async ([source, janela]) => {
      source.iconDataUrl = await getWindowIconDataUrl(janela.Path || null)
    })
  )

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
