import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { setupAuthHandlers } from './auth'
import { setupSessionHandlers } from './session'
import { setupUsersHandlers } from './users'
import { setupChatHandlers } from './chat'
import { destroyOverlay, setupOverlayHandlers } from './overlay'
import { destroyPopin, popinOpenHandler, setupPopinHandlers } from './popin'
import { setupScreenCapture } from './screenCapture'
import { setupLivekitHandlers } from './livekit'
import { setupRoomsHandlers } from './rooms'
import { flashTaskbar } from './taskbarFlash'
import { setupGstreamerHandlers, stopForAppQuit, isTransmitting } from './gstreamerCapture'
import { setupWebcamHandlers, stopWebcamForAppQuit, isWebcamTransmitting } from './webcamCapture'
import { setupUpdateHandlers } from './update'
import { setupGameDetectableCacheHandlers } from './gameDetectableCache'
import { API_BASE_URL } from './config'

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    // Evita o flash branco padrão do Electron antes do primeiro paint do
    // React (mesmo tom de --ev-c-black, usado no fundo de toda tela).
    backgroundColor: '#1b1b1f',
    autoHideMenuBar: true,
    // Antes só passava `icon` no Linux (padrão do template do
    // electron-vite — no Windows/Mac, o ícone do EXE empacotado já
    // resolvia isso). Passando em toda plataforma agora (2026-08-30, logo
    // nova do app): sem isso, a janela em modo dev (`npm run dev`, antes
    // de empacotar) mostraria o ícone padrão do Electron na titleBar em
    // vez da logo do app.
    icon,
    // TESTE (2026-09-03, pedido do usuário) — se não ficar bom,
    // desfazer: volta pra sem esses dois campos (titleBar 100% nativa
    // de novo). `titleBarStyle: 'hidden'` tira a barra de título nativa
    // (ícone + texto desenhados pelo Windows) inteira; `titleBarOverlay`
    // devolve só os botões de minimizar/maximizar/fechar (continuam
    // nativos, desenhados pelo Windows), com a cor de fundo/ícone que a
    // gente escolhe. O resto da faixa (ícone do app + título, agora
    // desenhados pela própria página) fica no componente TitleBar.tsx do
    // renderer — ver `.app-titlebar` em main.css.
    //
    // `color` transparente (pedido do usuário): a tela de login tem um
    // fundo customizado (gradiente/manchas de luz, ver .auth-page) que
    // não bate com uma cor chapada na faixa dos botões — transparente
    // deixa o fundo de cada tela aparecer por baixo também nessa faixa,
    // não só no resto da janela. Suportado pelo titleBarOverlay no
    // Windows (aceita rgba/hex com alpha) — só um efeito colateral
    // conhecido do próprio Electron: o hover dos botões pode não
    // respeitar a transparência direito (cosmético).
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: 'rgba(0,0,0,0)',
      symbolColor: '#ffffff',
      height: 32
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // A sobreposicao de viewers e uma JANELA. Se ela sobreviver ao
  // fechamento da principal, o 'window-all-closed' nunca dispara e o app
  // fica preso em segundo plano, sem UI e sem como sair.
  mainWindow.on('closed', destroyOverlay)
  mainWindow.on('closed', destroyPopin)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // O mini player é a ÚNICA janela que o renderer tem permissão de
    // abrir (ver popin.ts pro porquê de ele nascer de um `window.open`).
    // Todo o resto continua indo pro navegador do sistema.
    const popin = popinOpenHandler(details)
    if (popin) return popin
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Pedido do usuário (2026-09-01): mostrar a versão do app já na tela de
  // login, antes de qualquer autenticação — `update:check` (update.ts)
  // também devolve a versão atual, mas só depois de tentar checar
  // atualização de verdade (chamada de rede); esse canal aqui é só
  // `app.getVersion()` puro, sem rede nenhuma, pra poder rodar direto no
  // mount da LoginScreen sem esperar nada.
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // Roadmap item 43: o renderer precisa montar a URL de um avatar
  // customizado (<img src="{apiBaseUrl}/avatars/<id>.webp?v=<version>">)
  // — só o main conhece API_BASE_URL (config.ts), nunca exposto direto
  // por env var pro processo do renderer.
  ipcMain.handle('app:getApiBaseUrl', () => API_BASE_URL)

  // Destaque na barra de tarefas (2026-09-13; dos alertas desde a etapa 8,
  // 2026-10-22). Quem decide é o RENDERER, e não o main que recebe as
  // salas e o chat pelo WebSocket: é ele que conhece a preferência da
  // conta, os amigos e quais chats estão abertos.
  ipcMain.on('app:flashTaskbar', () => {
    flashTaskbar(mainWindow)
  })

  setupAuthHandlers()
  setupSessionHandlers()
  setupUsersHandlers()
  setupChatHandlers()
  setupOverlayHandlers()
  setupScreenCapture()
  setupLivekitHandlers()

  const mainWindow = createWindow()
  setupRoomsHandlers(mainWindow)
  setupGstreamerHandlers(mainWindow)
  setupWebcamHandlers(mainWindow)
  setupUpdateHandlers(mainWindow)
  setupPopinHandlers(mainWindow)
  setupGameDetectableCacheHandlers(mainWindow)

  // Pedido do usuário (2026-09-03): "Modo foco" (item 32 do roadmap — um
  // tile expande pra ocupar a janela inteira, ver `.watch-tile-focused`
  // em HomeScreen.tsx) muda a titleBar de transparente-sobre-o-conteúdo
  // pra opaca (cor de fundo da Home) reservando espaço de verdade —
  // `setTitleBarOverlay` (só Windows) permite trocar isso em tempo real
  // sem recriar a janela. Volta pro padrão (transparente) quando o modo
  // foco desliga — ver `useEffect` correspondente em HomeScreen.tsx.
  ipcMain.on('app:setTitleBarFocused', (_event, focused: boolean) => {
    mainWindow.setTitleBarOverlay({
      color: focused ? '#1b1b1f' : 'rgba(0,0,0,0)',
      symbolColor: '#ffffff',
      height: 32
    })
  })

  // Pedido do usuário (2026-08-31, substitui o comportamento antigo de
  // fire-and-forget): se o host fechar o app pelo "X" da barra de título
  // enquanto uma live via GStreamer está no ar, o app agora SEGURA o
  // fechamento, mostra "Parando transmissão..." (diálogo no renderer,
  // ver App.tsx) e só fecha de verdade depois que parar+derrubar a sala
  // for confirmado (renderer reaproveita a mesma lógica com retry de
  // `useGstreamerTransmission.ts` stop() — ver ROADMAP.md item 18 sobre
  // o bug que motivou isso: um fire-and-forget que falhasse silenciosamente
  // podia deixar a sala viva sem ninguém saber).
  let closeConfirmed = false
  let closeSafetyTimeout: ReturnType<typeof setTimeout> | null = null

  mainWindow.on('close', (event) => {
    // A webcam conta como transmissão também (2026-10-20, item 26): uma
    // sala aberta só por ela precisa ser derrubada do mesmo jeito.
    if (closeConfirmed || (!isTransmitting() && !isWebcamTransmitting())) return
    event.preventDefault()
    mainWindow.webContents.send('app:before-quit')

    // Rede de segurança: se o renderer nunca confirmar (travou, não
    // respondeu — ou o caminho normal via `useGstreamerTransmission.ts`
    // stop() está demorando demais pra confirmar deleteIngress/deleteRoom
    // de verdade), força o fechamento mesmo assim depois de um tempo —
    // sem isso, uma falha ali deixaria o app impossível de fechar.
    //
    // Bug real corrigido (2026-09-03, ROADMAP.md item 45): esse fallback
    // chamava `stopForAppQuit()` (síncrono, disparava deleteIngress/
    // deleteRoom sem esperar resposta) e, na linha seguinte, JÁ chamava
    // `mainWindow.close()` — nada garantia que aquelas duas chamadas de
    // rede chegassem no token-server antes do processo Electron morrer
    // de verdade (o comentário antigo assumia isso, mas o Electron não dá
    // essa garantia). `stopForAppQuit()` agora é assíncrona e tenta de
    // verdade (com retry, ver gstreamerCapture.ts) antes de fechar — só
    // que aumentado esse prazo (30s em vez de 20s) pra dar mais espaço pro
    // caminho normal terminar sozinho, e com um segundo teto (12s extras,
    // `forceCloseTimeout` abaixo) pra nunca deixar o fechamento do app
    // travado esperando a rede indefinidamente — o pedido original
    // ("fechar não pode ficar travado esperando o token-server") continua
    // valendo, só que sem sacrificar a confiabilidade do teardown.
    closeSafetyTimeout = setTimeout(() => {
      if (closeConfirmed) return
      closeConfirmed = true
      const forceCloseTimeout = setTimeout(() => mainWindow.close(), 12000)
      Promise.allSettled([stopForAppQuit(), stopWebcamForAppQuit()]).finally(() => {
        clearTimeout(forceCloseTimeout)
        mainWindow.close()
      })
    }, 30000)
  })

  ipcMain.on('app:confirmed-quit', () => {
    if (closeSafetyTimeout) clearTimeout(closeSafetyTimeout)
    closeConfirmed = true
    mainWindow.close()
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
