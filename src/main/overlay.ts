import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// Sobreposição de viewers (2026-09-10, pedido do usuário) — uma janela
// flutuante no canto superior esquerdo do monitor PRINCIPAL, listando
// quem está assistindo a live, pra quem só tem um monitor e não pode
// deixar o app visível enquanto joga.
//
// É uma janela normal do Electron, sem plugin nenhum. O que a faz virar
// "overlay" são quatro coisas, e cada uma resolve um problema distinto:
//
//   transparent + frame:false   sem moldura nem fundo, só o conteúdo
//   setAlwaysOnTop('screen-saver')  o nível mais alto que o Electron dá
//   setIgnoreMouseEvents(true)  cliques ATRAVESSAM — sem isso a overlay
//                               engoliria cliques no canto do jogo
//   setContentProtection(true)  ← a mais importante, ver abaixo
//
// SOBRE O setContentProtection: sem ele a overlay apareceria DENTRO da
// própria transmissão. A captura pega a área composta do desktop, e uma
// janela topmost entra nela — os viewers veriam uma lista deles mesmos
// sobreposta na live, e a feature se anularia. No Windows essa API aplica
// `WDA_EXCLUDEFROMCAPTURE`: visível pra você, invisível pra qualquer
// captura.
//
// LIMITAÇÃO CONHECIDA: jogo em fullscreen EXCLUSIVO cobre a overlay. Ele
// passa por cima do compositor do Windows, então não existe "por cima"
// pra desenhar. Driblar isso exigiria injetar DLL no processo do jogo
// (é o que Discord/Steam fazem), o que anti-cheats tratam como ataque e
// pode BANIR a conta — decidido não fazer. Na prática as Fullscreen
// Optimizations do Windows 10+ fazem a maioria dos jogos rodar em modo
// composto mesmo pedindo "fullscreen"; quando não rolar, a saída é o modo
// Borderless do próprio jogo (a tela de configurações avisa isso).

const WIDTH = 240
// Só o teto: a janela é redimensionada pra altura real do conteúdo
// (`overlay:resize`), pra área transparente não ficar maior que a lista e
// roubar espaço visual de nada.
const MAX_HEIGHT = 420
// Mesma folga do mini player (2026-09-20, pedido do usuário) — as duas
// janelinhas flutuantes ficam à mesma distância da borda da tela.
const MARGIN = 24

export interface OverlayViewer {
  name: string
  avatar: unknown
}

export interface OverlayState {
  visible: boolean
  viewers: OverlayViewer[]
  apiBaseUrl: string
}

let overlayWindow: BrowserWindow | null = null
// Último estado conhecido. A janela pode ainda não ter carregado quando o
// primeiro update chega — sem guardar, ela abriria vazia e só preencheria
// no próximo viewer entrando ou saindo.
let lastState: OverlayState = { visible: false, viewers: [], apiBaseUrl: '' }

function createOverlayWindow(): BrowserWindow {
  // Monitor PRINCIPAL, e não o da janela do app: é onde o jogo está.
  // `workArea` (e não `bounds`) respeita a barra de tarefas.
  const { workArea } = screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    x: workArea.x + MARGIN,
    y: workArea.y + MARGIN,
    width: WIDTH,
    height: MAX_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // Não rouba o foco do jogo ao aparecer — sem isto, alguém no meio de
    // uma partida seria tirado dela quando o primeiro viewer entrasse.
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.setContentProtection(true)
  // Aparece em todas as áreas de trabalho virtuais: quem troca de desktop
  // no meio da live continua vendo.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Nada aqui deve abrir link nenhum, mas se algum dia o conteúdo tiver um
  // <a>, ele vai pro navegador em vez de virar uma segunda janela sem
  // moldura e sem como fechar.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // O `#overlay` é o que faz o renderer montar a overlay em vez da Home
  // (ver App.tsx). Reaproveita o mesmo bundle da janela principal — o
  // Chromium já o tem em cache, então a segunda janela custa pouco.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#overlay`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  }

  win.on('closed', () => {
    overlayWindow = null
  })

  // `ready-to-show` e não `did-finish-load`: evita o flash de janela vazia
  // antes do React montar.
  win.once('ready-to-show', () => {
    win.showInactive() // showInactive, não show: de novo, não roubar foco
    win.webContents.send('overlay:state', lastState)
  })

  return win
}

function applyState(): void {
  if (lastState.visible) {
    if (!overlayWindow) overlayWindow = createOverlayWindow()
    else overlayWindow.webContents.send('overlay:state', lastState)
    return
  }

  // Fecha em vez de esconder: a overlay só existe durante a transmissão,
  // e uma janela escondida continua custando um processo de renderer.
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }
}

export function setupOverlayHandlers(): void {
  // Quem decide se a overlay aparece é o RENDERER, e não o main: ele já
  // tem as três coisas necessárias juntas (a preferência do usuário, se há
  // transmissão no ar, e quem está assistindo). Replicar isso aqui seria
  // manter o mesmo estado em dois lugares.
  ipcMain.on('overlay:update', (_event, state: OverlayState) => {
    lastState = state
    applyState()
  })

  // A altura vem do conteúdo: a lista cresce e encolhe conforme entram e
  // saem viewers, e uma janela de altura fixa deixaria uma área
  // transparente enorme (invisível, mas ocupando o topo da tela pra
  // qualquer futura interação).
  ipcMain.on('overlay:resize', (_event, height: number) => {
    if (!overlayWindow) return
    const clamped = Math.max(1, Math.min(Math.round(height), MAX_HEIGHT))
    overlayWindow.setBounds({ ...overlayWindow.getBounds(), height: clamped })
  })
}

// Chamado no fechamento do app: sem isso a overlay pode segurar o
// processo vivo depois da janela principal sumir.
export function destroyOverlay(): void {
  if (overlayWindow) {
    overlayWindow.destroy()
    overlayWindow = null
  }
}
