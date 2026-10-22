import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { BrowserWindow, ipcMain } from 'electron'
import { logGstreamer } from './gstreamerLog'
import { gstreamerEnv, resolveGstLaunchPath } from './gstreamerCapture'
import { deleteIngress, deleteRoom } from './livekit'

// ---------------------------------------------------------------------
// TRANSMISSÃO DA WEBCAM (2026-10-20, item 26 do roadmap)
//
// Uma segunda transmissão, independente da tela: processo próprio, ingress
// próprio, MESMA sala. Mora num módulo à parte de propósito — o pipeline
// da tela (gstreamerCapture.ts) é o caminho mais sensível do app, e nada
// aqui mexe nele. Os dois só dividem onde o GStreamer está e o ambiente
// dele.
//
// Só vídeo (decisão do usuário). O caminho até o encoder é o mesmo da tela
// — conversão na GPU e `mfh264enc` —, só a ponta muda: no lugar da captura
// de tela entra o `mfvideosrc` (Media Foundation), e câmera que entrega
// MJPEG passa antes pelo `jpegdec`. Testado na bancada em 2026-10-20 (ver
// a etapa 0 do item 26).
// ---------------------------------------------------------------------

let camProcess: ChildProcessWithoutNullStreams | null = null
// A sala em que a webcam está publicando — a do host, a mesma da tela se
// ela estiver no ar. Guardado aqui pelo mesmo motivo do `activeRoomCode`
// da tela: fechar o app de repente ainda precisa derrubar o ingress.
let camRoomCode: string | null = null
// Uma subida por vez, pela mesma razão do `startInFlight` da tela: o
// `camProcess` só é preenchido depois da sondagem, e nesse meio um segundo
// pedido passaria pela checagem.
let startInFlight = false

const BITRATE_PEAK_FACTOR = 1.4

// ---------------------------------------------------------------------
// QUAL MODO DA CÂMERA USAR
//
// Sem escolha de resolução nem FPS (decisão do usuário): o app pega
// sozinho o melhor que a câmera dá, até 1080p a 30 fps.
//
// O problema é que "o melhor" depende do formato. Webcam USB costuma dar
// 1080p30 SÓ em MJPEG, e em vídeo cru (YUY2) cai pra 5 fps nessa
// resolução. A integrada de notebook geralmente nem tem MJPEG. E o
// `gst-launch` não sabe tentar um formato e cair pro outro sozinho.
//
// Então antes de subir, o app SONDA: abre a câmera por um quadro com cada
// pedido, na ordem abaixo, e fica com o primeiro que a câmera aceitar. A
// resposta é guardada por câmera (a sondagem custa ~1s por tentativa,
// porque abre a câmera de verdade).
//
// O teto de 30 fps é de propósito: webcam a 60 não ganha nada visível e
// dobra o upload.
// ---------------------------------------------------------------------
interface CamMode {
  // Os caps que vão logo depois do `mfvideosrc`.
  caps: string
  // A câmera entrega JPEG e precisa do `jpegdec` antes da GPU.
  jpeg: boolean
}

const PROBE_ORDER: CamMode[] = [
  // MJPEG em 720p ou mais: é o caminho do 1080p30 das webcams USB.
  { caps: 'image/jpeg,width=[1280,1920],height=[720,1080],framerate=[24/1,30/1]', jpeg: true },
  // Vídeo cru, com fps de verdade. A integrada do notebook cai aqui.
  { caps: 'video/x-raw,width=[320,1920],height=[240,1080],framerate=[24/1,30/1]', jpeg: false },
  // MJPEG em qualquer resolução fluida.
  { caps: 'image/jpeg,width=[320,1920],height=[240,1080],framerate=[24/1,30/1]', jpeg: true },
  // Último recurso: o que a câmera der. Melhor uma webcam a 15 fps (pouca
  // luz derruba o fps de muita câmera) do que nenhuma.
  { caps: 'video/x-raw,width=[320,1920],height=[240,1080]', jpeg: false }
]

interface ProbedMode {
  mode: CamMode
  width: number
  height: number
  fps: number
}

const probeCache = new Map<string, ProbedMode>()

// O nome vai dentro de aspas no texto do pipeline: aspas no próprio nome
// quebrariam o parse, e barra invertida viraria escape.
function quoteDeviceName(name: string): string {
  return `"${name.replace(/["\\]/g, '')}"`
}

// Abre a câmera por UM quadro com os caps pedidos e lê o que foi
// negociado. `null` se a câmera não aceitou (ou não abriu).
function probeMode(deviceName: string, mode: CamMode): Promise<ProbedMode | null> {
  return new Promise((resolve) => {
    const args = [
      '-v',
      'mfvideosrc',
      `device-name=${quoteDeviceName(deviceName)}`,
      'num-buffers=1',
      '!',
      mode.caps,
      '!',
      'fakesink'
    ]
    const child = spawn(resolveGstLaunchPath(), args, { env: gstreamerEnv() })
    let output = ''
    child.stdout.on('data', (chunk) => (output += String(chunk)))
    child.stderr.on('data', (chunk) => (output += String(chunk)))

    // Uma câmera travada não pode segurar o início pra sempre.
    const timer = setTimeout(() => child.kill(), 8000)

    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        resolve(null)
        return
      }
      // A linha de caps do fakesink diz o que foi negociado de fato.
      const line = output.split('\n').find((l) => l.includes('fakesink0.GstPad:sink: caps'))
      const width = Number(/width=\(int\)(\d+)/.exec(line ?? '')?.[1] ?? 0)
      const height = Number(/height=\(int\)(\d+)/.exec(line ?? '')?.[1] ?? 0)
      const fpsMatch = /framerate=\(fraction\)(\d+)\/(\d+)/.exec(line ?? '')
      const fps = fpsMatch ? Math.round(Number(fpsMatch[1]) / Number(fpsMatch[2] || 1)) : 30
      if (!width || !height) {
        resolve(null)
        return
      }
      resolve({ mode, width, height, fps: fps || 30 })
    })
  })
}

async function resolveCamMode(deviceName: string): Promise<ProbedMode | null> {
  const cached = probeCache.get(deviceName)
  if (cached) return cached
  for (const mode of PROBE_ORDER) {
    const probed = await probeMode(deviceName, mode)
    logGstreamer(
      `webcam: sondagem "${mode.caps}" em "${deviceName}": ` +
        (probed ? `ok (${probed.width}x${probed.height}@${probed.fps})` : 'recusado')
    )
    if (probed) {
      probeCache.set(deviceName, probed)
      return probed
    }
  }
  return null
}

// Bitrate pela altura, com folga pro movimento de quem fala com a mão.
// Bem abaixo do da tela: rosto e fundo parado comprimem muito melhor que
// um jogo.
function bitrateFor(height: number): number {
  if (height >= 1080) return 4000
  if (height >= 720) return 2500
  return 1200
}

interface WebcamStartParams {
  roomCode: string
  whipUrl: string
  streamKey: string
  // O nome da câmera como o Windows o chama (ver o rótulo do Chromium,
  // sem o "(vid:pid)" — o renderer já manda limpo).
  deviceName: string
}

function buildArgs(params: WebcamStartParams, probed: ProbedMode): string[] {
  const bitrate = bitrateFor(probed.height)
  // Os caps EXATOS que a sondagem negociou — sem eles a câmera poderia
  // fixar outro modo na hora de subir de verdade.
  const exactCaps = probed.mode.jpeg
    ? `image/jpeg,width=${probed.width},height=${probed.height},framerate=${probed.fps}/1`
    : `video/x-raw,width=${probed.width},height=${probed.height},framerate=${probed.fps}/1`
  // Na sondagem "o que a câmera der" o fps pode não ser inteiro; ali vai
  // sem framerate nos caps, e a câmera fica com o dela.
  const capsForPipeline =
    probed.mode === PROBE_ORDER[PROBE_ORDER.length - 1]
      ? `video/x-raw,width=${probed.width},height=${probed.height}`
      : exactCaps

  return [
    '-e',
    'mfvideosrc',
    `device-name=${quoteDeviceName(params.deviceName)}`,
    '!',
    capsForPipeline,
    '!',
    ...(probed.mode.jpeg ? ['jpegdec', '!'] : []),
    // A mesma conversão na GPU da tela. `d3d11upload` porque a câmera
    // entrega em memória comum, e o encoder quer a da GPU.
    'd3d11upload',
    '!',
    'd3d11convert',
    '!',
    'video/x-raw(memory:D3D11Memory),format=NV12',
    '!',
    'mfh264enc',
    `bitrate=${bitrate}`,
    // Mesmo modo da tela (pcvbr) e pelo mesmo motivo: teto de verdade no
    // pico, sem encher de lixo a cena parada.
    'rc-mode=pcvbr',
    `max-bitrate=${Math.round(bitrate * BITRATE_PEAK_FACTOR)}`,
    `gop-size=${probed.fps * 2}`,
    'low-latency=true',
    '!',
    'h264parse',
    'config-interval=1',
    '!',
    'rtph264pay',
    'config-interval=1',
    'pt=96',
    '!',
    'queue',
    '!',
    'whip.sink_0',
    // Só um pad no whipsink: a webcam não tem áudio.
    'whipsink',
    'name=whip',
    `whip-endpoint=${params.whipUrl}`,
    `auth-token=${params.streamKey}`
  ]
}

// Mata o processo e espera ele sair. Sem disparar o `webcam:exited`: a
// morte aqui é pedida.
function killCamProcess(): Promise<void> {
  return new Promise((resolve) => {
    if (!camProcess) {
      resolve()
      return
    }
    const proc = camProcess
    camProcess = null
    proc.removeAllListeners('exit')
    proc.removeAllListeners('error')
    proc.once('exit', () => resolve())
    proc.once('error', () => resolve())
    proc.kill()
  })
}

// As mensagens que o GStreamer deixa no log quando a câmera não abre —
// traduzidas pro que a pessoa precisa saber.
function friendlyCamError(output: string): string {
  if (/not-negotiated/i.test(output)) {
    return 'A webcam não aceitou nenhum formato de vídeo compatível.'
  }
  return 'Não foi possível abrir a webcam. Ela pode estar sendo usada por outro programa (Discord, Teams, OBS) ou bloqueada nas configurações de privacidade do Windows.'
}

export function setupWebcamHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(
    'webcam:start',
    async (_event, params: WebcamStartParams): Promise<{ ok: boolean; error?: string }> => {
      if (camProcess || startInFlight) {
        return { ok: false, error: 'A webcam já está sendo transmitida.' }
      }
      startInFlight = true
      try {
        const probed = await resolveCamMode(params.deviceName)
        if (!probed) {
          return {
            ok: false,
            error:
              'Não foi possível abrir a webcam. Ela pode estar sendo usada por outro programa (Discord, Teams, OBS) ou bloqueada nas configurações de privacidade do Windows.'
          }
        }

        const exePath = resolveGstLaunchPath()
        const args = buildArgs(params, probed)
        // O stream key fica fora do log, como no da tela não fica — aqui
        // não há por que repetir o erro.
        logGstreamer(
          `webcam: iniciando ${probed.width}x${probed.height}@${probed.fps} ` +
            `(${probed.mode.jpeg ? 'MJPEG' : 'cru'}) em "${params.deviceName}", sala ${params.roomCode}`
        )

        const child = spawn(exePath, args, { env: gstreamerEnv() })
        camProcess = child
        camRoomCode = params.roomCode

        // Mesmo sinal da tela (ver startPipeline em gstreamerCapture.ts):
        // a linha de PLAYING quer dizer que a câmera abriu e o encoder
        // existe. Uma vez por processo.
        const MARCA_PLAYING = 'Setting pipeline to PLAYING'
        let avisouPlaying = false
        let rabo = ''
        let output = ''
        child.stdout.on('data', (chunk) => {
          const text = String(chunk)
          logGstreamer(`webcam stdout: ${text}`)
          output = (output + text).slice(-4000)
          if (avisouPlaying) return
          const texto = rabo + text
          if (!texto.includes(MARCA_PLAYING)) {
            rabo = texto.slice(-MARCA_PLAYING.length)
            return
          }
          avisouPlaying = true
          rabo = ''
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('webcam:playing', { roomCode: params.roomCode })
          }
        })
        child.stderr.on('data', (chunk) => {
          const text = String(chunk)
          logGstreamer(`webcam stderr: ${text}`)
          output = (output + text).slice(-4000)
        })

        // Só numa morte INESPERADA — o `killCamProcess` tira os listeners
        // antes de matar.
        child.on('error', (err) => {
          logGstreamer(`webcam: erro ao iniciar processo: ${err.message}`)
          camProcess = null
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('webcam:exited', { code: null, error: err.message })
          }
        })
        child.on('exit', (code) => {
          logGstreamer(`webcam: processo encerrado, code=${code}`)
          camProcess = null
          // Um modo que a sondagem aprovou e o pipeline de verdade
          // recusou não pode ficar no cache: a próxima tentativa sonda
          // de novo.
          probeCache.delete(params.deviceName)
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('webcam:exited', {
              code,
              error: code === 0 ? undefined : friendlyCamError(output)
            })
          }
        })

        return { ok: true }
      } finally {
        startInFlight = false
      }
    }
  )

  ipcMain.handle('webcam:stop', async (): Promise<{ ok: boolean }> => {
    await killCamProcess()
    camRoomCode = null
    return { ok: true }
  })
}

// O app está fechando com a webcam no ar (ver o 'close' em index.ts).
// Derruba o ingress dela e a SALA: fechando o app, a tela vai junto, e
// derrubar a sala duas vezes (aqui e no stopForAppQuit da tela) é
// inofensivo. Poucas tentativas, como na tela — o fechamento tem teto.
export async function stopWebcamForAppQuit(): Promise<void> {
  await killCamProcess()
  const roomCode = camRoomCode
  camRoomCode = null
  if (!roomCode) return
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ingressOk = await deleteIngress(roomCode, 'cam')
    const roomOk = await deleteRoom(roomCode)
    if (ingressOk && roomOk) {
      logGstreamer(`app fechando: webcam e sala ${roomCode} derrubadas (tentativa ${attempt})`)
      return
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  logGstreamer(`app fechando: NÃO foi possível confirmar a queda da webcam/sala ${roomCode}`)
}

export function isWebcamTransmitting(): boolean {
  return camRoomCode !== null
}
