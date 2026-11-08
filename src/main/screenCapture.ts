import { desktopCapturer, ipcMain, screen } from 'electron'
import { windowAppName, windowsByHandle } from './nativeCaptureTargets'
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
  // Taxa de atualização (Hz) do monitor em que essa fonte está
  // (2026-10-09) — a tela de configuração usa isso pra oferecer FPS que
  // divida a taxa em número inteiro, ver `fpsOptionsFor` em
  // transmissionSettings.ts. `null` quando não dá pra saber.
  refreshHz: number | null
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

// A taxa de atualização (Hz) de cada tela.
//
// POR QUE A GRADE PRECISA DISSO (2026-10-09): a captura só recebe quadro
// novo quando o monitor apresenta um, ou seja, em múltiplos de 1/Hz.
// Pedir um FPS que NÃO divide a taxa em número inteiro — 60 num monitor
// de 144 Hz dá 2,4 quadros por amostra — faz o capturador alternar entre
// pegar 2 e 3 quadros de movimento e carimbar os dois com o mesmo
// intervalo. O contador marca 60fps certinho e a imagem treme assim
// mesmo. Quem consome isso é `fpsOptionsFor` (transmissionSettings.ts).
//
// MONITOR: exato, pelo `display_id` que o próprio Chromium já entrega.
//
// JANELA: o Electron não diz em que tela a janela está, e a enumeração
// nativa não devolve as bordas dela — então só dá pra responder quando
// TODAS as telas rodam na mesma taxa, que é o caso da esmagadora
// maioria. Com taxas diferentes entre monitores fica `null`, e a tela de
// configuração cai nas opções padrão em vez de chutar a tela errada.
function refreshRates(): { byDisplayId: Map<number, number>; uniform: number | null } {
  const displays = screen.getAllDisplays()
  const byDisplayId = new Map<number, number>()
  for (const display of displays) {
    // Vem 0 quando o Windows não informa a taxa daquela saída.
    if (display.displayFrequency > 0) {
      byDisplayId.set(display.id, Math.round(display.displayFrequency))
    }
  }

  const rates = [...byDisplayId.values()]
  // Só é "a taxa da máquina" se TODA tela respondeu e todas responderam
  // o mesmo — uma tela sem taxa conhecida já invalida o palpite.
  const uniform =
    rates.length > 0 && rates.length === displays.length && rates.every((hz) => hz === rates[0])
      ? rates[0]
      : null

  return { byDisplayId, uniform }
}

// A JANELA QUE NÃO ESTÁ ABERTA (2026-10-13, pedido do usuário)
//
// Apareceu na grade um card de uma janela que não existia na máquina —
// pelo desenho, o teclado virtual do Windows. É o `TextInputHost.exe`,
// título "Experiência de Entrada do Windows": um app UWP que o sistema
// mantém vivo o tempo todo pra atender o teclado de toque, a emoji e o
// ditado. Ele TEM janela de topo e TEM título, então enumera; o Chromium
// lista; e a pessoa vê uma janela que nunca abriu.
//
// O que separa ele de uma janela de verdade é o DWM: `DWMWA_CLOAKED`
// marca a janela que existe mas que o compositor NÃO desenha. Três
// valores, e só um deles é ambíguo:
//
//   cloaked + nesta área de trabalho   fantasma — é este caso aqui
//   cloaked + em OUTRA área            janela real, só que noutro lugar
//   não cloaked                        janela normal
//
// Por isso a regra exige as duas coisas (`Cloaked !== 0` E
// `OnCurrentDesktop === 1`): quem usa áreas de trabalho virtuais não
// perde as janelas das outras. E `OnCurrentDesktop` vale -1 quando não
// deu pra saber, que também não entra na conta — na dúvida a janela
// fica, porque o erro caro é a janela da pessoa sumir, não um fantasma
// a mais.
//
// RESSALVA: isto é um filtro de volta. A grade parou de filtrar em
// 2026-09-30 a pedido do usuário (ela tirava minimizadas, janelas de
// ferramenta e auxiliares, e com elas iam janelas que a pessoa queria).
// Este é o único filtro que voltou, e é mais estreito que qualquer um
// daqueles: não fala de minimizada (uma janela minimizada não é cloaked
// — conferido na máquina do usuário, todas com `Cloaked: 0`) nem de
// janela de ferramenta. Fala só de janela que o Windows não está
// desenhando, e que por isso capturaria preto ou congelado.
//
// Custo: zero. `Cloaked` e `OnCurrentDesktop` já vinham na enumeração
// que a grade já fazia pra montar ícone e nome do programa.
function ehFantasma(janela: NativeWindow): boolean {
  return janela.Cloaked !== 0 && janela.OnCurrentDesktop === 1
}

// A CAMADA INVISÍVEL (2026-10-17, pedido do usuário). O teclado virtual
// voltou à grade, agora por outra porta: o `TabTip.exe` ("Teclado Virtual
// e Painel de Manuscrito") abre uma janela "Shell Handwriting Canvas" do
// tamanho da tela pra receber a caneta. Ela NÃO é cloaked — o DWM
// desenha, só que transparente — então passava pelo `ehFantasma`.
//
// Medido na máquina do usuário: estilo estendido 0x0A0800A8, ou seja,
// janela de ferramenta + `LAYERED` + `TRANSPARENT` (o clique atravessa) +
// sempre no topo. A regra exige as três primeiras juntas, de propósito
// estreita como as outras: uma janela que nem o mouse consegue tocar, que
// não está na barra de tarefas nem no Alt-Tab, não é uma janela que a
// pessoa abriu — é sobreposição (teclado de toque, overlay de jogo), e
// capturada daria um quadro transparente.
function ehCamadaInvisivel(janela: NativeWindow): boolean {
  return janela.ToolWindow && janela.ClickThrough === true
}

// A SUPERFÍCIE DO SHELL (2026-10-23, pedido do usuário). Abrir o menu
// Iniciar punha na grade dois cards, "Iniciar" e "Pesquisar" — e o mesmo
// vale pra central de notificações, o painel de rede/som, o seletor de
// emoji. Fechadas, essas janelas ficam cloaked e o `ehFantasma` já as
// tira; abertas, o DWM desenha, e elas passavam.
//
// Em vez de uma lista de títulos (que muda com o idioma e a cada
// atualização do Windows), a regra é pela ORIGEM, com duas chaves juntas:
//   - a classe `Windows.UI.Core.CoreWindow` de TOPO — a janela crua de um
//     app UWP. A de um app UWP comum (To Do, Calculadora) aberto vive
//     DENTRO de um `ApplicationFrameWindow`, que é o card dele;
//   - o executável em `%windir%\SystemApps\` — a pasta onde o Windows
//     guarda os pedaços do próprio shell (StartMenuExperienceHost,
//     SearchHost, ShellExperienceHost, TextInputHost). App da loja mora em
//     `WindowsApps`, e não entra.
// Caminho vazio (processo que recusou a leitura) não é julgado: fica.
function ehSuperficieDoShell(janela: NativeWindow): boolean {
  return (
    janela.ClassName === 'Windows.UI.Core.CoreWindow' &&
    /\\SystemApps\\/i.test(janela.Path || '')
  )
}

// O título sem o contador de não lidas na frente — "(3) WhatsApp" e
// "WhatsApp" são a mesma janela pra quem olha a grade.
function tituloSemContador(titulo: string): string {
  return titulo.replace(/^\(\d+\)\s*/, '').trim()
}

// A JANELA EMBUTIDA QUE SE PASSA POR OUTRA (2026-10-16, pedido do
// usuário). O WhatsApp é um app WinUI (`WhatsApp.Root`) que desenha o
// conteúdo num WebView2 — e o WebView2 é um PROCESSO filho
// (`msedgewebview2`) com uma janela de topo própria, com o mesmo título.
// O Chromium lista as duas, e a grade mostrava o WhatsApp duas vezes:
// uma com o nome do app, outra como "Microsoft Edge WebView2".
//
// A regra exige as TRÊS coisas ao mesmo tempo, de propósito estreita
// (ver a ressalva de `ehFantasma`: a grade não filtra por gosto):
//   - é janela de ferramenta (fora da barra de tarefas e do Alt-Tab);
//   - o processo dela descende do processo de OUTRO card da grade;
//   - os dois têm o mesmo título (tirando o contador de não lidas).
// Ou seja: é a cópia embutida de uma janela que já está na grade, e
// quem fica é a janela do app de verdade.
//
// Custo: zero — `ToolWindow` e `Ancestors` já vinham na mesma
// enumeração que monta ícone e nome.
function ehCopiaEmbutida(janela: NativeWindow, outras: NativeWindow[]): boolean {
  if (!janela.ToolWindow) return false
  const titulo = tituloSemContador(janela.Title)
  return outras.some(
    (outra) =>
      outra !== janela &&
      outra.Pid !== janela.Pid &&
      !outra.ToolWindow &&
      janela.Ancestors.includes(outra.Pid) &&
      tituloSemContador(outra.Title) === titulo
  )
}

export interface ListSourcesOptions {
  // `false` pede a lista SEM capturar miniatura (2026-10-13). O
  // `thumbnailSize` zerado faz o Chromium pular a captura de cada janela,
  // que é o que custa caro aqui — sobram nome, id e ícone do programa, e
  // o card já sabe se desenhar assim (ver CaptureSourceCard.tsx).
  //
  // A grade do dialog não usa mais isto desde 2026-10-23 (a atualização
  // de 3 em 3 segundos traz a miniatura junto, ver SourcePickerDialog.tsx);
  // fica pra quem só precisa da lista.
  thumbnails?: boolean
  // Aceita a última grade COMPLETA se ela for mais nova que isto. É o
  // que faz a pré-carga da Home valer: a tela de iniciar abre com tudo
  // pronto em vez de começar do zero no clique.
  maxAgeMs?: number
}

// O TAMANHO DA MINIATURA (2026-10-17, pedido do usuário: "melhorar a
// qualidade"). Era 320 x 180, e o tile do dialog tem ~275px de CSS —
// numa tela a 125% ou 150% isso são 345 a 410 pixels de verdade, então a
// imagem era ESTICADA e saía borrada. 640 x 360 sobra até 200% de escala,
// e o navegador só reduz, que é o que fica nítido.
//
// Em JPEG, não PNG: com o dobro de lado, o PNG de uma tela cheia de
// texto passa fácil dos 300 KB por card, e são vinte cards atravessando o
// IPC e sendo decodificados no renderer a cada atualização da grade —
// que é justamente a travadinha que o usuário viu ao rolar. O JPEG dessa
// mesma miniatura fica em dezenas de KB.
const MINIATURA = { width: 640, height: 360 }
const MINIATURA_JPEG_QUALIDADE = 85

// A última grade completa (com miniatura). Só o resultado COMPLETO entra
// aqui: uma lista sem miniatura no cache responderia a pergunta errada
// pra quem pediu a grade inteira.
let ultimaGrade: { at: number; sources: CaptureSource[] } | null = null

// A grade de seleção de fonte.
//
// QUEM LISTA É O CHROMIUM (2026-09-30, pedido do usuário): a grade mostra
// exatamente as telas e janelas que o `desktopCapturer` devolveu — nem
// uma a mais (o app acrescentava as minimizadas/cloaked que ele descarta),
// nem uma a menos (o app descartava as fantasma, as janelas de ferramenta
// e as auxiliares de um mesmo app). A enumeração nativa entra
// só pra dizer o que o Chromium não sabe: o HWND de cada card, o nome do
// programa e o ícone.
// O NOME DE UMA TELA (2026-10-16, pedido do usuário): "Tela 1", "Tela 2"...
// no lugar do que o Chromium dá ("Screen 1", ou "Entire screen" quando só
// existe uma). A posição é a da tela entre as TELAS da lista, na ordem do
// `desktopCapturer` — a mesma nas duas chamadas que usam isto (a grade,
// aqui, e a resolução da fonte no gstreamerCapture.ts), então o nome que
// a pessoa escolheu na grade é o mesmo que a sala mostra depois.
export function screenDisplayName(
  sources: ReadonlyArray<{ id: string }>,
  sourceId: string
): string {
  const screens = sources.filter((source) => source.id.startsWith('screen:'))
  const index = screens.findIndex((source) => source.id === sourceId)
  return `Tela ${index >= 0 ? index + 1 : 1}`
}

async function listSources(options: ListSourcesOptions = {}): Promise<CaptureSource[]> {
  const { thumbnails = true, maxAgeMs = 0 } = options

  if (ultimaGrade && maxAgeMs > 0 && Date.now() - ultimaGrade.at <= maxAgeMs) {
    logGstreamer(`listSources: reaproveitando a grade de ${Date.now() - ultimaGrade.at}ms atrás`)
    return ultimaGrade.sources
  }

  // As duas perguntas são INDEPENDENTES, e é isso que as deixa correr
  // juntas (2026-09-25) — a enumeração sai de graça atrás das miniaturas,
  // que é o que realmente custa aqui.
  const [sources, porHandle] = await Promise.all([
    desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: thumbnails ? MINIATURA : { width: 0, height: 0 }
    }),
    windowsByHandle().catch((err) => {
      // Sem a enumeração a grade ainda funciona: fica com as mesmas
      // janelas, só que sem ícone e sem o nome do programa.
      logGstreamer(`listSources: enumeração de janelas falhou: ${err}`)
      return null
    })
  ])

  const { byDisplayId, uniform } = refreshRates()

  const result: CaptureSource[] = sources.map((source) => {
    const displayId =
      source.display_id && Number.isFinite(Number(source.display_id))
        ? Number(source.display_id)
        : null

    const isScreen = source.id.startsWith('screen:')
    return {
      id: source.id,
      name: isScreen ? screenDisplayName(sources, source.id) : source.name,
      type: isScreen ? 'screen' : 'window',
      thumbnailDataUrl: source.thumbnail.isEmpty()
        ? ''
        : `data:image/jpeg;base64,${source.thumbnail.toJPEG(MINIATURA_JPEG_QUALIDADE).toString('base64')}`,
      displayId,
      // Monitor: a taxa daquela tela. Janela (displayId null): a taxa
      // comum, e só quando todas as telas rodam na mesma.
      refreshHz: (displayId !== null ? byDisplayId.get(displayId) : undefined) ?? uniform,
      appName: null,
      iconDataUrl: null
    }
  })

  // Sem a enumeração não dá pra julgar fantasma nem pôr ícone: vai o que
  // o Chromium listou, como sempre foi o degrau de baixo aqui.
  if (!porHandle) return guardar(result, thumbnails)

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

  // 2. Fora as fantasmas (ver `ehFantasma` lá em cima).
  //
  //    Só julga o card que casou com uma janela da enumeração: o que não
  //    casou fica, porque "não sei o que é isso" nunca pode virar "então
  //    some com ele".
  //    A camada invisível (`ehCamadaInvisivel`) e a superfície do shell
  //    (`ehSuperficieDoShell`) saem no mesmo passo.
  const semFantasmas = result.filter((source) => {
    const janela = janelaDoCard.get(source)
    if (!janela) return true
    const motivo = ehFantasma(janela)
      ? 'janela que o Windows não está desenhando nesta área de trabalho'
      : ehCamadaInvisivel(janela)
        ? 'camada transparente que o clique atravessa'
        : ehSuperficieDoShell(janela)
          ? 'parte do shell do Windows (menu Iniciar, pesquisa, notificações)'
          : null
    if (!motivo) return true
    logGstreamer(`listSources: escondendo "${janela.Title}" (${janela.ProcessName}) — ${motivo}`)
    janelaDoCard.delete(source)
    return false
  })

  // 2b. Fora as cópias embutidas (ver `ehCopiaEmbutida` lá em cima).
  //     Compara só contra os cards que SOBRARAM: se a janela do app
  //     tivesse saído como fantasma, a cópia é a única que restou e fica.
  const janelasNaGrade = [...janelaDoCard.values()]
  const visiveis = semFantasmas.filter((source) => {
    const janela = janelaDoCard.get(source)
    if (!janela || !ehCopiaEmbutida(janela, janelasNaGrade)) return true
    logGstreamer(
      `listSources: escondendo "${janela.Title}" (${janela.ProcessName}) — ` +
        'janela embutida de outro app que já está na grade'
    )
    janelaDoCard.delete(source)
    return false
  })

  // 3. Ícones, em paralelo. `getWindowIconDataUrl` é cacheado POR
  //    CAMINHO de executável, então N janelas do mesmo programa custam
  //    uma leitura só — e da segunda abertura da grade em diante não
  //    custam nenhuma.
  await Promise.all(
    [...janelaDoCard].map(async ([source, janela]) => {
      source.iconDataUrl = await getWindowIconDataUrl(janela.Path || null)
    })
  )

  return guardar(visiveis, thumbnails)
}

// Guarda a grade pra quem pedir uma recente — só a COMPLETA, ver
// `ultimaGrade`.
function guardar(sources: CaptureSource[], thumbnails: boolean): CaptureSource[] {
  if (thumbnails) ultimaGrade = { at: Date.now(), sources }
  return sources
}

// Usado pela TransmissionScreen (itens 9/10/11 do roadmap) só pra montar
// a grade de thumbnails/nomes — a captura em si (via GStreamer) resolve o
// `sourceId` escolhido pro HMONITOR/HWND real do Windows por conta
// própria (ver gstreamerCapture.ts/nativeCaptureTargets.ts), sem
// depender de `getDisplayMedia`/`setDisplayMediaRequestHandler` do
// Chromium — removido em 2026-08-30 junto com o resto do caminho de
// captura via Chromium (ver MEMORIA.md).
export function setupScreenCapture(): void {
  ipcMain.handle('screenCapture:listSources', (_event, options?: ListSourcesOptions) =>
    listSources(options)
  )

  // PRÉ-CARGA (2026-10-13, pedido do usuário): a Home manda montar a
  // grade enquanto a pessoa ainda está nela, pra que a tela de iniciar
  // abra com tudo pronto em vez de começar do zero no clique.
  //
  // Não devolve nada de propósito. A grade completa são dezenas de
  // miniaturas em base64 — alguns megabytes atravessando o IPC — e quem
  // pré-carrega não vai desenhar nada com elas. Fica no `ultimaGrade`
  // daqui, e a tela de iniciar pega de lá com `maxAgeMs`.
  //
  // Engolir o erro é o certo: falhar numa pré-carga que ninguém pediu não
  // pode virar um erro na tela de quem está só olhando a lista de lives.
  ipcMain.handle('screenCapture:prefetch', async (): Promise<void> => {
    try {
      await listSources()
    } catch (err) {
      logGstreamer(`prefetch da grade falhou (sem consequência): ${err}`)
    }
  })
}
