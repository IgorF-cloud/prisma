import { BrowserWindow, HandlerDetails, ipcMain, screen } from 'electron'

// MINI PLAYER (2026-09-20, pedido do usuário) — uma live assistida sai da
// grade do app e vira uma janelinha sempre-no-topo, ancorada num canto da
// tela.
//
// ---------------------------------------------------------------------
// POR QUE ESTA JANELA NASCE DE UM `window.open()` NO RENDERER
//
// A overlay de viewers (overlay.ts) é uma `new BrowserWindow` que carrega
// o bundle de novo — e é um PROCESSO à parte. Aqui isso não serve: o
// requisito é a live continuar tocando sem desconectar e reconectar o
// viewer, e uma MediaStreamTrack não atravessa processos. Reencaminhar o
// vídeo por um WebRTC local resolveria, ao custo de um encode/decode a
// mais e de bem mais código.
//
// `window.open()` de mesma origem devolve uma janela no MESMO processo do
// renderer. Medido antes de escrever isto, inclusive no caminho de
// produção (`file://`, o caso arriscado): o opener alcança o `document`
// da filha e a MESMA track toca lá (`mesmaTrack: true`, frames
// avançando). Então o Electron aqui só precisa cuidar do que é de
// janela — moldura, tamanho, sempre-no-topo, arrasto e ancoragem. Quem
// desenha o conteúdo é o React da janela principal, por um portal (ver
// PopinPlayer.tsx).
// ---------------------------------------------------------------------

// PREFIXO do nome da janela no `window.open(url, nome)`, e não o nome
// inteiro. É por ele que o handler distingue "o mini player" de um link
// qualquer que alguém clicou.
//
// Prefixo porque cada abertura usa um SUFIXO único (ver PopinPlayer.tsx
// pro bug real que isso conserta): `window.open` com um nome que já
// existe reaproveita a janela daquele nome em vez de criar outra — e
// nesse caminho ele nem chega neste handler.
export const POPIN_FRAME_PREFIX = 'prisma-popin'

const DEFAULT_WIDTH = 480
// 16:9 travado (decisão do usuário): a janela é exatamente o vídeo, sem
// tarja preta em canto nenhum. O mínimo pedido foi 300x200; 200 de altura
// em 16:9 dá 356 de largura, então é esse o mínimo real.
const ASPECT = 16 / 9
const MIN_HEIGHT = 200
const MIN_WIDTH = Math.round(MIN_HEIGHT * ASPECT)
// Distância das bordas da tela quando ancorada (pedido do usuário).
const MARGIN = 24

// Arrasto e ancoragem.
const SNAP_DURATION_MS = 180
const SNAP_TICK_MS = 16

let popinWindow: BrowserWindow | null = null
// Enquanto true, os eventos `moved`/`resized` são ignorados: quem está
// movendo a janela somos nós, e reagir a isso seria realimentar a
// animação.
let movingItOurselves = false
// O arrasto em andamento, ou `null` quando não há nenhum — é também o que
// impede um `drag-move` atrasado de mover a janela depois de solta.
//
// O TAMANHO FICA GUARDADO AQUI (2026-09-20, 3a rodada), e esse detalhe é
// o conserto de um bug que só aparecia em tela 4K: a janelinha ia
// CRESCENDO sozinha enquanto era arrastada.
//
// A causa é a ida e volta entre pixels lógicos e físicos. O Electron fala
// em DIP e o Windows em pixels reais; num monitor com escala fracionária
// (150%, o normal num 4K), ler o tamanho atual dá um número quebrado que
// é arredondado PRA CIMA, e escrevê-lo de volta arredonda de novo. Cada
// movimento relia o tamanho recém-escrito — 60 vezes por segundo, cada
// uma um pixel maior que a anterior. Em 100% (1080p/1440p) a conta é
// exata e nada disso aparece, que é exatamente o que o usuário observou.
//
// Medindo UMA vez, no começo do arrasto, e reenviando sempre o mesmo
// número, o arredondamento deixa de se acumular: dá no mesmo tamanho
// físico todas as vezes.
let drag: { offsetX: number; offsetY: number; width: number; height: number } | null = null
let snapTimer: ReturnType<typeof setInterval> | null = null

function clearTimers(): void {
  if (snapTimer) {
    clearInterval(snapTimer)
    snapTimer = null
  }
  drag = null
}

// Canto mais próximo do CENTRO da janela, na tela em que ela está.
// `workArea` (e não `bounds`) respeita a barra de tarefas — ancorar no
// canto inferior direito com `bounds` deixaria a janela por baixo dela.
function cornerFor(win: BrowserWindow): { x: number; y: number } {
  const b = win.getBounds()
  const centerX = b.x + b.width / 2
  const centerY = b.y + b.height / 2
  const { workArea } = screen.getDisplayNearestPoint({ x: centerX, y: centerY })

  const esquerda = workArea.x + MARGIN
  const direita = workArea.x + workArea.width - b.width - MARGIN
  const topo = workArea.y + MARGIN
  const base = workArea.y + workArea.height - b.height - MARGIN

  return {
    x: centerX < workArea.x + workArea.width / 2 ? esquerda : direita,
    y: centerY < workArea.y + workArea.height / 2 ? topo : base
  }
}

// Desaceleração no fim, pra a janela "assentar" no canto em vez de parar
// seco — é uma animação curta, o easing é o que a faz parecer um ímã.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function snapToCorner(win: BrowserWindow): void {
  if (snapTimer) clearInterval(snapTimer)

  const from = win.getBounds()
  const to = cornerFor(win)
  if (from.x === to.x && from.y === to.y) return

  const começo = Date.now()
  movingItOurselves = true
  snapTimer = setInterval(() => {
    if (!popinWindow || popinWindow.isDestroyed()) {
      clearTimers()
      movingItOurselves = false
      return
    }
    const t = Math.min(1, (Date.now() - começo) / SNAP_DURATION_MS)
    const p = easeOutCubic(t)
    popinWindow.setBounds({
      x: Math.round(from.x + (to.x - from.x) * p),
      y: Math.round(from.y + (to.y - from.y) * p),
      width: from.width,
      height: from.height
    })
    if (t >= 1) {
      clearTimers()
      movingItOurselves = false
    }
  }, SNAP_TICK_MS)
}

// Opções da janelinha, pro `setWindowOpenHandler` da janela principal
// (ver index.ts). Devolve null pra qualquer outra coisa — um link
// clicado continua indo pro navegador.
export function popinOpenHandler(details: HandlerDetails): {
  action: 'allow'
  overrideBrowserWindowOptions: Electron.BrowserWindowConstructorOptions
} | null {
  if (!details.frameName.startsWith(POPIN_FRAME_PREFIX)) return null

  // Canto inferior direito do monitor PRINCIPAL, que é onde um mini
  // player costuma nascer. Daí em diante quem manda é o usuário.
  const { workArea } = screen.getPrimaryDisplay()
  const width = DEFAULT_WIDTH
  const height = Math.round(DEFAULT_WIDTH / ASPECT)

  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      x: workArea.x + workArea.width - width - MARGIN,
      y: workArea.y + workArea.height - height - MARGIN,
      width,
      height,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      frame: false,
      // Sem `transparent: true` de propósito (decisão do usuário): o
      // Windows 11 arredonda a janela sozinho com `roundedCorners`, e
      // janela transparente não redimensiona arrastando a borda — o que
      // obrigaria a implementar alças de resize na mão. No Windows 10
      // isto é ignorado e a janela fica quadrada.
      roundedCorners: true,
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      // Não aparece na barra de tarefas: é um acessório da janela
      // principal, não uma segunda janela do app.
      skipTaskbar: true,
      // Enquanto o primeiro frame não chega, preto — sem isto a janela
      // pisca branco ao abrir.
      backgroundColor: '#000000',
      show: false
    }
  }
}

// Chamado quando a janela realmente nasce (`did-create-window`). É aqui
// que entra tudo o que só existe como método, não como opção.
function adoptPopinWindow(win: BrowserWindow): void {
  popinWindow = win

  // 16:9 travado: o usuário redimensiona pelo canto e a proporção se
  // mantém sozinha.
  win.setAspectRatio(ASPECT)
  // O nível mais alto que o Electron dá — mesmo da overlay de viewers,
  // com a mesma limitação conhecida: fullscreen EXCLUSIVO de jogo passa
  // por cima (borderless não).
  win.setAlwaysOnTop(true, 'screen-saver')
  // Invisível pra captura (decisão do usuário): se a pessoa também
  // estiver transmitindo, o mini player não entra na live dela — senão
  // ela retransmitiria a live de outra pessoa sem querer. Mesma API da
  // overlay (`WDA_EXCLUDEFROMCAPTURE` no Windows).
  win.setContentProtection(true)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // A JANELA NÃO APARECE AQUI (2026-09-20).
  //
  // Mostrar no `did-create-window` é mostrar cedo demais: neste
  // instante o renderer ainda nem voltou do `window.open` (foram 47ms no
  // teste do usuário), o conteúdo ainda não foi movido pra dentro dela e
  // o vídeo não pintou o primeiro quadro. O que aparece é um retângulo
  // preto que só depois vira a live — e em desenvolvimento, onde o
  // <StrictMode> abre uma janela, fecha e abre outra, isso vira uma
  // piscada.
  //
  // Quem manda mostrar é o renderer, quando tem imagem (`popin:ready`,
  // lá embaixo). De quebra, a janela descartada do ciclo do StrictMode
  // costuma morrer antes de chegar a esse ponto — ou seja, nunca chega a
  // aparecer.

  // Redimensionar pelo canto pode afastar a janela da âncora (o lado que
  // o usuário puxa é o que se move); voltar pro canto mantém a promessa
  // de "ela fica ancorada".
  win.on('resized', () => {
    if (!movingItOurselves) snapToCorner(win)
  })

  win.on('closed', () => {
    // SÓ se a janela que morreu ainda for a atual (2026-09-20).
    //
    // Em desenvolvimento o <StrictMode> monta, desmonta e monta de novo
    // todo efeito — então o mini player abre a janela A, fecha A e abre
    // B em seguida. O 'closed' de A chega DEPOIS de B já ter sido
    // adotada, e sem esta guarda ele zerava a referência da janela viva:
    // arrastar e ancorar paravam de funcionar, em dev, sem erro nenhum
    // na tela.
    if (popinWindow !== win) return
    clearTimers()
    movingItOurselves = false
    popinWindow = null
  })
}

export function setupPopinHandlers(mainWindow: BrowserWindow): void {
  mainWindow.webContents.on('did-create-window', (child, details) => {
    if (details.frameName.startsWith(POPIN_FRAME_PREFIX)) adoptPopinWindow(child)
  })

  // ARRASTO NO MAIN, E NÃO VIA `-webkit-app-region: drag` (2026-09-20).
  //
  // A região de arrasto do Chromium faz o Windows tratar aquela área
  // como barra de título (HTCAPTION), e área de título não recebe os
  // eventos de mouse da página — ou seja, o hover que mostra os chips e
  // escurece a janela ficaria sem funcionar justamente onde a pessoa
  // passa o mouse. Como o mini player é quase todo "área de arrasto",
  // isso custaria a interface inteira.
  //
  // QUEM DITA O RITMO MUDOU (2026-09-20, 2a rodada). Antes era um
  // `setInterval` de 16ms aqui, lendo `screen.getCursorScreenPoint()`. A
  // ideia era evitar um IPC por movimento do mouse — mas o preço era o
  // movimento travado que o usuário sentiu: no Windows um timer de 16ms
  // não é de 16ms (a granularidade do sistema é ~15,6ms e os disparos
  // são coalescidos), então as posições chegavam em intervalos desiguais
  // — ora 16, ora 31 — enquanto o cursor reporta a 125-1000 Hz. Amostrar
  // um movimento contínuo num relógio irregular É o tranco.
  //
  // Agora quem manda a posição é o renderer, a partir dos eventos de
  // ponteiro (o próprio fluxo de entrada do sistema), agrupados em um
  // envio por quadro do `requestAnimationFrame` DA JANELINHA — ou seja,
  // no compasso do vsync dela, que é exatamente o compasso em que a tela
  // consegue mostrar a janela em outro lugar. Continua sendo ~60 IPCs
  // por segundo, o mesmo volume de antes; a diferença é que agora eles
  // são regulares e casados com o desenho.
  //
  ipcMain.on('popin:drag-start', (_event, cursorX: number, cursorY: number) => {
    const win = popinWindow
    if (!win || win.isDestroyed()) return
    clearTimers()

    const bounds = win.getBounds()
    // O ponto vem do renderer (e não de `getCursorScreenPoint`) de
    // propósito: é o mesmo sistema de coordenadas dos `drag-move` que
    // vêm a seguir. Misturar as duas fontes é como se paga um salto no
    // primeiro quadro em tela com escala (150%, 4K).
    drag = {
      offsetX: cursorX - bounds.x,
      offsetY: cursorY - bounds.y,
      width: bounds.width,
      height: bounds.height
    }
    movingItOurselves = true
  })

  ipcMain.on('popin:drag-move', (_event, cursorX: number, cursorY: number) => {
    const win = popinWindow
    if (!win || win.isDestroyed() || !drag) return
    // Largura e altura vão junto, e são SEMPRE as da abertura do arrasto
    // — ver o comentário do `drag` lá em cima pro bug de 4K que isso
    // conserta. `setPosition` não serve aqui: por dentro ele relê o
    // tamanho atual, que é justamente a leitura que acumula o erro.
    win.setBounds({
      x: Math.round(cursorX - drag.offsetX),
      y: Math.round(cursorY - drag.offsetY),
      width: drag.width,
      height: drag.height
    })
  })

  ipcMain.on('popin:drag-end', () => {
    const win = popinWindow
    // O renderer avisa o fim por mais de um caminho (soltar o botão,
    // perder a captura do ponteiro) e os dois podem chegar. Sem esta
    // guarda, o segundo dispararia uma segunda ancoragem por cima da
    // primeira, no meio da animação.
    const estavaArrastando = drag !== null
    clearTimers()
    movingItOurselves = false
    if (estavaArrastando && win && !win.isDestroyed()) snapToCorner(win)
  })

  // "Já tenho imagem, pode mostrar" — ver o comentário em
  // adoptPopinWindow. Só a janela ATUAL, e só uma vez: o renderer manda
  // isto no primeiro quadro do vídeo e também por um timer de
  // segurança, caso o quadro demore.
  ipcMain.on('popin:ready', () => {
    const win = popinWindow
    if (!win || win.isDestroyed() || win.isVisible()) return
    // `showInactive` e não `show`: quem clicou no botão está usando o
    // app, e roubar o foco pra janelinha tiraria a pessoa de onde ela
    // estava.
    win.showInactive()
  })

  // Voltar pro app (botão de expandir): a janela principal pode estar
  // minimizada — o pedido é que ela APAREÇA. `restore` sozinho não
  // basta se ela nunca foi minimizada mas está atrás de tudo.
  ipcMain.on('popin:restore-app', () => {
    if (mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

// Fechamento do app: sem isto a janelinha segura o processo vivo depois
// da principal sumir (mesmo cuidado do destroyOverlay).
export function destroyPopin(): void {
  clearTimers()
  if (popinWindow && !popinWindow.isDestroyed()) popinWindow.destroy()
  popinWindow = null
}
