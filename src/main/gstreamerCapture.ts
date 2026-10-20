import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { app, BrowserWindow, desktopCapturer, ipcMain } from 'electron'
import {
  resolveMonitorHandle,
  resolveWindowTarget,
  resolveWindowByHandle,
  findDiscordPid
} from './nativeCaptureTargets'
import { getGstreamerLogPath, logGstreamer } from './gstreamerLog'
import { deleteIngress, deleteRoom } from './livekit'
import { EXTRA_WINDOW_PREFIX, WINDOW_HANDLE_PREFIX, screenDisplayName } from './screenCapture'
import {
  handleTransmissionSourceChanged,
  stopGameDetection,
  stopGameDetectionForAppQuit
} from './gameDetection'
import {
  handleFollowSourceChanged,
  isFollowingAutoWindow,
  stopFollowing,
  tryRecoverFromExit
} from './gameWindowFollow'
import { notifyRoomReconnecting } from './roomReconnect'

// Item novo do roadmap ("Live via GStreamer"): captura de tela fora do
// Chromium (que mediu ~45fps mesmo na área de trabalho, ver MEMORIA.md do
// Electron) via GStreamer + Desktop Duplication API (d3d11screencapturesrc)
// + Media Foundation (mfh264enc, H264 por GPU) + WHIP (whipsink) direto pro
// LiveKit Ingress. Reaproveita o pipeline já validado no app Flutter
// (D:\MY PROJECTS\taon\lib\core\gstreamer_publisher.dart) — mesmos
// elementos, mesma ordem (capsfilter DEPOIS do d3d11convert, whipsink em
// vez de whipclientsink porque esse último quebrava com o encoder de
// hardware desta máquina).
//
// Resolução/FPS/bitrate agora vêm da TransmissionScreen (mesma tela do
// caminho antigo via Chromium — itens 9/10/11 do roadmap, reimplementados
// aqui) — nada mais é fixo, exceto o codec (h264) e o próprio pipeline.
let gstProcess: ChildProcessWithoutNullStreams | null = null
// Sala/ingress da transmissão em andamento (se houver) — guardado aqui,
// não só no renderer, pra dar pra derrubar a sala mesmo se o app for
// fechado de repente (botão "X" da barra de título do Windows, ver
// stopForAppQuit abaixo e o listener 'close' em index.ts).
let activeRoomCode: string | null = null

// Quanto o encoder pode passar do bitrate ALVO num pico — vira o
// `max-bitrate` do modo pcvbr (ver buildArgs).
//
// 1.4x dá respiro pra uma cena complexa sem voltar ao `uvbr`, que era
// o padrão e não tinha limite nenhum. O teto importa mais que o alvo:
// é ele que define o PIOR caso que a rede precisa engolir, e é o pior
// caso que derruba pacote.
//
// Mora aqui, e não junto da tabela de bitrate no renderer, porque é
// característica do ENCODER — passar mais um número pelo IPC só pra
// ele ser reusado aqui seria contrato a mais sem ganho nenhum.
const BITRATE_PEAK_FACTOR = 1.4

// ---------------------------------------------------------------------
// ONDE ESTÁ O GSTREAMER (2026-09-18)
//
// Desde esta data o app EMBARCA o mínimo do GStreamer que usa (~35 MB,
// 55 arquivos) em vez de mandar o instalador baixar os 528 MB do pacote
// oficial. Ver `installer/collect-gstreamer.ps1` pra como o conjunto é
// montado, e MEMORIA.md pro porquê.
//
// A busca tem TRÊS degraus, e a ordem importa:
//
//   1. O EMBARCADO. É o que a esmagadora maioria vai usar, e é o que
//      garante que todo mundo roda a mesma versão — a detecção do
//      instalador antigo não olhava versão nenhuma, então a base
//      instalada hoje é uma mistura.
//   2. O INSTALADO no sistema. Quem já tinha o GStreamer antes continua
//      funcionando, e uma build rodando fora do instalador (um `npm run
//      dev` numa máquina que tem o pacote completo) também.
//   3. O PATH, como último recurso.
//
// Os degraus 2 e 3 são o caminho de volta se o embarcado der problema:
// basta o conjunto não estar lá que o app usa o do sistema, sem mudar
// uma linha de código.
// ---------------------------------------------------------------------

// Onde a pasta `gstreamer/` fica em cada mundo.
//
// EMPACOTADO: o instalador põe em `{app}\gstreamer`, ao lado do
// Prisma.exe — `process.execPath` aponta pro próprio Prisma.exe.
//
// DESENVOLVIMENTO: `process.execPath` é o electron.exe de node_modules,
// que não ajuda. Aí vale a pasta do repositório, a MESMA que o
// instalador empacota — assim `npm run dev` funciona numa máquina sem
// GStreamer instalado, que passou a ser o caso desta aqui.
function gstreamerRootCandidates(): string[] {
  if (app.isPackaged) return [join(dirname(process.execPath), 'gstreamer')]
  return [join(app.getAppPath(), 'installer', 'gstreamer')]
}

function resolveBundledGstreamerRoot(): string | null {
  for (const root of gstreamerRootCandidates()) {
    if (existsSync(join(root, 'bin', 'gst-launch-1.0.exe'))) return root
  }
  return null
}

function resolveGstLaunchPath(): string {
  const bundled = resolveBundledGstreamerRoot()
  if (bundled) return join(bundled, 'bin', 'gst-launch-1.0.exe')

  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const candidate = `${programFiles}\\gstreamer\\1.0\\msvc_x86_64\\bin\\gst-launch-1.0.exe`
  if (existsSync(candidate)) return candidate
  // Fallback pro PATH, caso a instalação não seja no caminho padrão.
  return 'gst-launch-1.0.exe'
}

// O ambiente do processo do gst-launch.
//
// Com o conjunto embarcado, o GStreamer precisa que digam a ele onde as
// coisas estão — nada disso está num lugar que ele adivinhe:
//
//   GST_PLUGIN_SYSTEM_PATH  onde procurar plugins. Apontado SÓ pra nossa
//                           pasta, e é isso que evita o pior cenário de
//                           depuração: numa máquina que também tem o
//                           GStreamer completo instalado, ele misturaria
//                           os dois conjuntos e o teste "falta alguma
//                           coisa?" passaria por engano.
//   GST_PLUGIN_PATH         vazio pelo mesmo motivo.
//   GST_PLUGIN_SCANNER      o ajudante que indexa os plugins.
//   GST_REGISTRY            o cache do índice. Vai pro userData porque
//                           `{app}` é Program Files, onde um app sem
//                           privilégio não escreve — e sem poder gravar,
//                           o GStreamer reindexa tudo a cada início.
//   GIO_MODULE_DIR          módulos do GIO, carregados por caminho.
//   PATH                    o `bin` na frente, senão as DLLs do núcleo
//                           não são encontradas.
//
// Sem conjunto embarcado (degraus 2 e 3), devolve o ambiente intacto: o
// GStreamer do sistema já sabe se virar sozinho, e mexer nas variáveis
// dele só criaria um jeito novo de quebrar.
function gstreamerEnv(): NodeJS.ProcessEnv {
  const root = resolveBundledGstreamerRoot()
  if (!root) return process.env

  const bin = join(root, 'bin')
  return {
    ...process.env,
    GST_PLUGIN_SYSTEM_PATH: join(root, 'lib', 'gstreamer-1.0'),
    GST_PLUGIN_PATH: '',
    GST_PLUGIN_SCANNER: join(root, 'libexec', 'gstreamer-1.0', 'gst-plugin-scanner.exe'),
    GST_REGISTRY: join(app.getPath('userData'), 'gstreamer-registry.bin'),
    GIO_MODULE_DIR: join(root, 'lib', 'gio', 'modules'),
    PATH: `${bin};${process.env['PATH'] ?? ''}`
  }
}

// Traduz o `sourceId` escolhido na TransmissionScreen (formato do
// desktopCapturer, ex: "screen:0:0"/"window:1234:0") pro argumento real
// que o d3d11screencapturesrc entende (monitor-handle=<HMONITOR> ou
// window-handle=<HWND>) — ver nativeCaptureTargets.ts pro porquê de não
// dar pra usar o id do desktopCapturer direto.
// `windowListMaxAgeMs` deixa reaproveitar uma leitura recente da máquina
// em vez de fazer outra (2026-09-20, ver enumerateSnapshot). Só quem
// ACABOU de enumerar passa um valor aqui — hoje só o `gstreamer:update`,
// que pode vir logo atrás de uma decisão do seguidor de janela.
//
// Desde 2026-10-13 vale pras TELAS também, e não só pras janelas: as duas
// respostas saem da mesma execução do helper nativo (ver
// windowEnumeration.ts). O nome ficou — mudá-lo seria mexer em três
// chamadas pra não dizer nada de novo.
async function resolveCaptureArg(
  sourceId: string | null,
  windowListMaxAgeMs = 0
): Promise<
  | {
      name: string
      value: string
      windowPid?: number
      windowTitle?: string
      // Item 29 do roadmap, pedido do usuário (2026-09-05): nome do
      // processo dono da janela escolhida — gameDetection.ts cruza ele
      // com a lista de jogos do Discord pra decidir entre "Jogando: X" e
      // "Transmitindo: <título da janela>".
      windowProcessName?: string
      // Caminho do executável dessa janela (2026-09-06) — usado só pra
      // saber se ela é um jogo rodando pela Steam, ver gameDetection.ts.
      windowProcessPath?: string | null
      // Item 29 do roadmap, pedido do usuário (2026-09-03): nome da fonte
      // de monitor escolhida (ex: "Screen 1"), mesmo que já aparece na
      // grade de seleção da TransmissionScreen — usado só como FALLBACK
      // em gameDetection.ts, quando nenhum jogo é detectado transmitindo
      // um monitor inteiro (mostra "Transmitindo: <nome do monitor>" em
      // vez de nada).
      sourceName?: string
    }
  | { error: string }
> {
  // Janela identificada pelo HWND exato. Nasceu pra troca automática de
  // janela (2026-09-10, ver gameWindowFollow.ts), onde o app já sabe qual
  // HWND quer; desde 2026-09-24 é também a forma normal dos cards da
  // grade (ver handleFromDesktopCapturerId em screenCapture.ts), o que
  // faz duas janelas de mesmo título deixarem de ser a mesma escolha.
  // Primeiro do encadeamento porque é o caso mais específico.
  if (sourceId?.startsWith(WINDOW_HANDLE_PREFIX)) {
    const handle = sourceId.slice(WINDOW_HANDLE_PREFIX.length)
    const target = await resolveWindowByHandle(handle, windowListMaxAgeMs)
    if (!target) {
      // Serve pros dois caminhos: a janela seguida sumiu no meio da live,
      // ou a escolhida na grade fechou entre a listagem e o "iniciar".
      return { error: 'A janela escolhida não está mais aberta.' }
    }
    logGstreamer(
      `window-handle resolvido por HWND: handle=${target.handle} pid=${target.pid} título="${target.title}"`
    )
    return {
      name: 'window-handle',
      value: target.handle,
      windowPid: target.pid,
      windowTitle: target.title,
      windowProcessName: target.processName,
      windowProcessPath: target.processPath
    }
  }

  // Fontes "extras" (ver EXTRA_WINDOW_PREFIX em screenCapture.ts): a
  // grade não produz mais nenhuma, mas o `sourceId` da última
  // transmissão fica guardado nas configurações — um id antigo ainda
  // chega aqui depois de uma atualização. O título vem embutido no
  // próprio id, resolve direto.
  if (sourceId?.startsWith(EXTRA_WINDOW_PREFIX)) {
    const title = decodeURIComponent(sourceId.slice(EXTRA_WINDOW_PREFIX.length))
    const target = await resolveWindowTarget(title)
    if (!target) {
      return {
        error: `Não foi possível encontrar a janela "${title}" (feche e reabra o app escolhido, se ele tiver sido reaberto desde a seleção).`
      }
    }
    logGstreamer(
      `window-handle resolvido (fonte extra) pro título "${title}": handle=${target.handle} pid=${target.pid}`
    )
    return {
      name: 'window-handle',
      value: target.handle,
      windowPid: target.pid,
      windowTitle: title,
      windowProcessName: target.processName,
      windowProcessPath: target.processPath
    }
  }

  // SEM MINIATURA (2026-10-13). O `thumbnailSize` do `getSources` tem
  // padrão 150x150 — omiti-lo não é "não pedir miniatura", é pedir uma de
  // 150px. Aqui só interessam `id`, `name` e `display_id`; a imagem era
  // capturada de TODA janela da máquina, jogada fora, e isso acontecia
  // duas vezes a cada live (uma na detecção da fonte, outra no start).
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 }
  })
  const selected = sourceId ? sources.find((source) => source.id === sourceId) : undefined
  const fallback = sources.find((source) => source.id.startsWith('screen:'))
  const chosen = selected ?? fallback

  if (!chosen) {
    return { error: 'Nenhuma fonte de captura disponível.' }
  }

  logGstreamer(
    `fonte escolhida: id=${chosen.id} name="${chosen.name}" display_id="${chosen.display_id}"`
  )

  if (chosen.id.startsWith('screen:')) {
    // `display_id` vem vazio "em algumas plataformas" (doc do Electron) —
    // visto na prática (Windows) em 2026-08-30. `Number('')` é 0, não
    // NaN, então checar isFinite sozinho não pega esse caso — por isso o
    // `chosen.display_id ? ... : null` explícito abaixo, em vez de
    // `Number(chosen.display_id)` direto.
    const displayId = chosen.display_id ? Number(chosen.display_id) : NaN
    const handle = await resolveMonitorHandle(
      Number.isFinite(displayId) ? displayId : null,
      windowListMaxAgeMs
    )
    if (!handle) {
      return { error: 'Não foi possível mapear o monitor escolhido pro GStreamer.' }
    }
    logGstreamer(`monitor-handle resolvido: ${handle}`)
    // "Tela N", o mesmo nome da grade (ver screenDisplayName) — é ele que
    // a sala mostra quando nenhum jogo é detectado na tela.
    return {
      name: 'monitor-handle',
      value: handle,
      sourceName: screenDisplayName(sources, chosen.id)
    }
  }

  const target = await resolveWindowTarget(chosen.name)
  if (!target) {
    return {
      error: `Não foi possível encontrar a janela "${chosen.name}" (feche e reabra o app escolhido, se ele tiver sido reaberto desde a seleção).`
    }
  }
  logGstreamer(
    `window-handle resolvido pro título "${chosen.name}": handle=${target.handle} pid=${target.pid}`
  )
  return {
    name: 'window-handle',
    value: target.handle,
    windowPid: target.pid,
    windowTitle: chosen.name,
    windowProcessName: target.processName,
    windowProcessPath: target.processPath
  }
}

type ResolvedCapture = Awaited<ReturnType<typeof resolveCaptureArg>>

// A fonte que o renderer mandou resolver no clique, antes de a sala
// existir (ver 'gstreamer:prepareSource').
let preparedSource: {
  sourceId: string | null
  at: number
  result: Promise<ResolvedCapture>
} | null = null

// Até quando uma resolução antecipada vale. O caminho normal leva de
// meio a um segundo entre o prepare e o start; o que passar muito disso
// é um start que não veio daquele clique, e a janela pode ter fechado.
const PREPARED_SOURCE_MAX_AGE_MS = 10000

// Consome a resolução antecipada se ela for desta fonte e ainda recente;
// senão resolve agora, como sempre foi. Consome (e não só lê) pra que um
// segundo start nunca reaproveite a fonte de outra live.
function takePreparedSource(sourceId: string | null): Promise<ResolvedCapture> {
  const prepared = preparedSource
  preparedSource = null
  if (
    prepared &&
    prepared.sourceId === sourceId &&
    Date.now() - prepared.at < PREPARED_SOURCE_MAX_AGE_MS
  ) {
    return prepared.result
  }
  return resolveCaptureArg(sourceId)
}

// Item 31 do roadmap ("Ignorar áudio do Discord"): mesma lógica do app
// Flutter (lib/core/gstreamer_publisher.dart + window_enumerator.dart).
// WASAPI2 só aceita UM pid de loopback-target por vez — não dá pra
// excluir o Discord E a própria árvore do Electron ao mesmo tempo (ver
// histórico da conversa que pediu isso). Captura de janela específica
// isola o áudio dela via include-process-tree (Discord e todo o resto já
// saem de fora, de graça). Captura de monitor inteiro não tem "o pid
// certo" pra incluir, então cai pra excluir só o Discord, se estiver
// aberto — deixando de excluir a própria árvore do Electron (efeito
// colateral aceito: se o host assistir outra live enquanto transmite o
// monitor inteiro, o áudio dela pode vazar de volta pra própria
// transmissão, ver item 23).
// Quanto tempo o PID do Discord pode ter de idade aqui.
//
// Quem chama é o `startPipeline`, imediatamente depois de
// `resolveCaptureArg` ter lido a máquina inteira — o número existe pra
// que essa leitura seja REAPROVEITADA em vez de virar um segundo
// processo do helper no mesmo clique. Cinco segundos é folga pro caminho
// todo (resolver a fonte, montar os argumentos) sem chegar perto de um
// Discord que tenha aberto ou fechado no meio; e se isso acontecer, o
// pior caso é a exclusão de áudio de uma live mirando um PID velho —
// o mesmo risco que já existia com a leitura feita na hora.
const AUDIO_PID_MAX_AGE_MS = 5000

async function resolveAudioLoopbackArgs(windowPid: number | undefined): Promise<string[]> {
  if (windowPid !== undefined) {
    logGstreamer(`áudio: isolando o processo da janela capturada (pid=${windowPid})`)
    return ['loopback-mode=include-process-tree', `loopback-target-pid=${windowPid}`]
  }

  const discordPid = await findDiscordPid(AUDIO_PID_MAX_AGE_MS)
  if (discordPid !== null) {
    logGstreamer(`áudio: excluindo o Discord da captura (pid=${discordPid})`)
    return ['loopback-mode=exclude-process-tree', `loopback-target-pid=${discordPid}`]
  }

  logGstreamer('áudio: Discord não encontrado rodando — captura de sistema sem filtro')
  return []
}

interface BuildArgsParams {
  whipUrl: string
  streamKey: string
  // Teto de pico do encoder (ver rc-mode=pcvbr em buildArgs).
  // Calculado aqui no main a partir do alvo — ver BITRATE_PEAK_FACTOR
  // no topo deste arquivo.
  maxBitrateKbps: number
  captureArgName: string
  captureArgValue: string
  width: number
  height: number
  fps: number
  bitrateKbps: number
  audioLoopbackArgs: string[]
}

function buildArgs(params: BuildArgsParams): string[] {
  const {
    whipUrl,
    streamKey,
    captureArgName,
    captureArgValue,
    width,
    height,
    fps,
    bitrateKbps,
    maxBitrateKbps,
    audioLoopbackArgs
  } = params
  return [
    '-e',
    'd3d11screencapturesrc',
    `${captureArgName}=${captureArgValue}`,
    // Sem isso o cursor do host não aparece na captura — a Desktop
    // Duplication API entrega o cursor separado do frame por padrão,
    // esse elemento só compõe ele na imagem se pedido explicitamente.
    'show-cursor=true',
    '!',
    'd3d11convert',
    '!',
    `video/x-raw(memory:D3D11Memory),format=NV12,width=${width},height=${height},framerate=${fps}/1`,
    '!',

    // SEM FILA ENTRE A CAPTURA E O ENCODER (rollback, 2026-10-17).
    //
    // Entre 2026-10-09 e esta data havia aqui um `queue` de 3 quadros com
    // `leaky=downstream`, pra que um soluço do encoder não segurasse o
    // laço de captura. Saiu na investigação de lives congelando a cada
    // segundo em dois usuários (1.4.0), junto com as outras mudanças do
    // caminho do vídeo daquela versão — sem causa confirmada, voltou tudo
    // ao que a 1.3.0 tinha e funcionava.
    //
    // O suspeito, nesta peça: com um jogo puxando a GPU, o encoder atrasa
    // e a fila passa a jogar quadros fora em rajada, onde antes a captura
    // só desacelerava junto.
    'mfh264enc',
    `bitrate=${bitrateKbps}`,

    // TETO de verdade (2026-09-11). O padrão do mfh264enc nesta
    // máquina é `uvbr` — variável SEM restrição — e com ele o
    // `bitrate` acima não limita nada, só sugere: numa cena
    // movimentada o encoder estoura pra muito acima do alvo. Era a
    // causa provável do padrão "roda liso, trava, volta" relatado
    // pelo usuário: pico -> perda de pacote -> congelamento.
    //
    // `pcvbr` (peak constrained) e não `cbr` de propósito: captura de
    // tela passa muito tempo PARADA (menu, desktop, leitura). Em CBR
    // o encoder enche o bitrate com lixo pra bater a meta mesmo numa
    // tela estática, desperdiçando a banda que faz falta na hora da
    // ação. Com pcvbr a cena calma custa pouco e a agitada vai até o
    // teto — sem passar dele.
    'rc-mode=pcvbr',
    `max-bitrate=${maxBitrateKbps}`,

    // Um keyframe a cada 2 segundos (2026-09-11). O padrão é -1
    // (automático), que deixa o intervalo a cargo do driver e costuma
    // dar GOPs longos.
    //
    // Isso não evita perda de pacote — encurta o ESTRAGO de cada uma.
    // Perdido um pacote, o decodificador fica corrompido até o
    // próximo keyframe; com GOP longo isso vira um congelamento de
    // vários segundos, com 2s vira um engasgo. O custo é banda: o
    // keyframe é o quadro mais caro, e mandar mais deles come parte
    // do orçamento. 2s é o meio-termo usado por streaming em geral.
    `gop-size=${fps * 2}`,

    'low-latency=true',
    '!',
    'h264parse',
    'config-interval=1',
    '!',
    'rtph264pay',
    'config-interval=1',
    'pt=96',
    '!',

    // A `queue` padrão (até 1 s / 200 buffers), como na 1.3.0 (rollback,
    // 2026-10-17). Entre 2026-10-16 e esta data ela era limitada a 200 ms;
    // saiu junto com a fila de antes do encoder (ver acima). Com keyframes
    // de ~400 KB a cada 2 s (medido a 1080p48), 200 ms deixava pouca folga
    // pra rajada num upload no limite.
    'queue',
    '!',
    'whip.sink_0',
    // Áudio do sistema via loopback (WASAPI2) — o filtro de processo
    // (isolar uma janela específica, ou excluir o Discord) já vem
    // resolvido em `audioLoopbackArgs`, ver resolveAudioLoopbackArgs.
    'wasapi2src',
    'loopback=true',

    // O ÁUDIO NÃO DÁ O RELÓGIO DA LIVE (2026-10-17, causa das travadas em
    // TELA INTEIRA relatadas na 1.4.0).
    //
    // Sem isto o `wasapi2src` vira o relógio do pipeline inteiro
    // (`New clock: GstAudioSrcClock` no log), e a captura de vídeo espera
    // ESSE relógio pra soltar cada quadro. No loopback do DISPOSITIVO — o
    // que a tela inteira usa quando o Discord não está aberto (ver
    // resolveAudioLoopbackArgs) — o Windows entrega o áudio aos trancos, e
    // o relógio anda do mesmo jeito: para ~117 ms e pula.
    //
    // Medido nesta máquina, mesmo monitor, 60 FPS pedidos, 12 s:
    //   relógio do áudio   ~100 quadros/s, 282 com carimbo REPETIDO
    //                      (rajadas de 7 quadros "no mesmo instante") e
    //                      123 voltando 1 ms no tempo
    //   relógio do sistema 60,1 quadros/s, nenhum repetido
    // Quem assiste recebe as rajadas e congela tentando ordená-las.
    //
    // Por que só tela inteira: janela usa o loopback POR PROCESSO
    // (include-process-tree), e a tela inteira com Discord aberto também
    // (exclude) — esses entregam áudio contínuo, e o relógio não engasga.
    //
    // Com `provide-clock=false` o pipeline usa o relógio do sistema e o
    // áudio é que se ajusta a ele. Vale pros três modos: nenhum precisa
    // do relógio do áudio, e assim nenhum fica refém dele.
    'provide-clock=false',
    ...audioLoopbackArgs,
    '!',
    'audioconvert',
    '!',
    'audioresample',
    '!',

    // FORMATO FIXO antes do encoder (2026-09-30, defeito relatado pelo
    // usuário: áudio "abafado"). Sem estes caps, quem manda no formato é
    // o que o loopback do WASAPI entregar naquela máquina — e o
    // `audioconvert`/`audioresample` acima só fazem o mínimo pra fechar a
    // negociação com o encoder. Numa placa entregando mono, a live saía
    // mono; entregando 44100, o opusenc reamostrava por conta própria
    // (ele só aceita 48/24/16/12/8 kHz).
    //
    // Pedir 48000/2 explicitamente força a conversão a acontecer AQUI,
    // nos dois elementos que existem pra isso, e o encoder recebe sempre
    // a mesma coisa em qualquer máquina. 48 kHz porque é a taxa nativa do
    // Opus — qualquer outra vira reamostragem no caminho.
    'audio/x-raw,rate=48000,channels=2',
    '!',
    'opusenc',

    // 128 kbps (2026-09-30). O padrão do `opusenc` é 64000 — que é
    // bitrate de VOZ. Pra áudio de jogo (música, efeito, explosão) 64k
    // em estéreo obriga o codec a jogar fora agudo pra caber, e é
    // exatamente isso que se ouve como "abafado". 128k é o ponto em que
    // o Opus em estéreo fica transparente na prática pra este tipo de
    // material; acima disso o ganho não se nota.
    //
    // Custo: +64 kbps sobre o orçamento da transmissão. Perto do vídeo
    // (medido em milhares de kbps, ver `bitrateKbps`) isso é ruído de
    // arredondamento.
    'bitrate=128000',

    // Já é o padrão do elemento, escrito por extenso de propósito: o
    // outro valor possível é `voice`, que aplica modelo de fala e é o
    // caminho mais curto pra trazer o som abafado de volta. Explícito
    // aqui, ninguém troca sem querer.
    'audio-type=generic',

    // Correção de erro DENTRO do próprio Opus (2026-10-16): cada pacote
    // leva uma cópia em baixa qualidade do anterior. Se um se perde no
    // caminho, quem assiste reconstrói o trecho a partir do seguinte em
    // vez de ouvir um estalo/buraco. `packet-loss-percentage` diz ao
    // encoder quanta perda esperar — é o que decide quanto do bitrate vai
    // pra essa redundância.
    'inband-fec=true',
    'packet-loss-percentage=10',
    '!',
    'rtpopuspay',
    'pt=97',
    '!',

    // Mesmo limite de 200 ms do vídeo, mas aqui com `leaky`: o áudio não
    // tem fila antes do encoder pra absorver a pressão (segurar o
    // `wasapi2src` vira picote), e um pacote de Opus perdido é um trecho
    // de 20 ms que o FEC acima recupera — não corrompe nada adiante.
    'queue',
    'max-size-buffers=0',
    'max-size-bytes=0',
    'max-size-time=200000000',
    'leaky=downstream',
    '!',
    'whip.sink_1',
    'whipsink',
    'name=whip',
    `whip-endpoint=${whipUrl}`,
    `auth-token=${streamKey}`
  ]
}

interface StartParams {
  roomCode: string
  whipUrl: string
  streamKey: string
  sourceId: string | null
  width: number
  height: number
  fps: number
  bitrateKbps: number
}

// Uma morte de processo que o seguidor de janelas está tentando
// consertar (2026-09-14).
//
// Existe porque nesse intervalo — entre o processo morrer e o renderer
// mandar o update com a janela nova — NÃO HÁ processo nenhum, e o
// `gstreamer:update` recusa updates sem processo. Esta flag é o que diz
// pra ele: "tem uma transmissão viva sim, só sem pipeline no momento".
//
// O timer é a saída de emergência. Se o update não chegar (o renderer
// não estava ouvindo, a fonte não resolveu), a live não pode ficar
// eternamente "ao vivo" sem ninguém publicando — aí o `gstreamer:exited`
// sai atrasado e o renderer derruba a sala como sempre fez.
let followRecovery: {
  timer: ReturnType<typeof setTimeout>
  exitCode: number | null
} | null = null

// Um pouco acima do PENDING_TIMEOUT_MS do seguidor (15s), pra ele
// desistir primeiro: assim quem desarma o automático é o dono dele.
const FOLLOW_RECOVERY_TIMEOUT_MS = 18_000

function clearFollowRecovery(): void {
  if (followRecovery) {
    clearTimeout(followRecovery.timer)
    followRecovery = null
  }
}

// A recuperação não deu certo: a live acabou de verdade, e o renderer
// precisa saber disso pra derrubar sala e ingress. O código de saída é
// o da morte ORIGINAL — é ela que explica o que aconteceu.
function finishFailedRecovery(mainWindow: BrowserWindow): void {
  const code = followRecovery?.exitCode ?? null
  clearFollowRecovery()
  stopFollowing()
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gstreamer:exited', { code })
  }
}

async function handleUnexpectedExit(mainWindow: BrowserWindow, code: number | null): Promise<void> {
  // Uma segunda morte enquanto a primeira ainda está sendo recuperada:
  // desiste das duas. Insistir aqui seria um laço de reinício
  // disfarçado.
  if (followRecovery) {
    finishFailedRecovery(mainWindow)
    return
  }

  // O seguidor está numa janela que ELE escolheu: esta morte pode muito
  // bem ser o fim da partida fechando a janela do jogo, e a tentativa de
  // voltar pro cliente leva segundos (tryRecoverFromExit insiste, porque
  // o cliente do LoL some da lista de janelas enquanto está escondido).
  //
  // Avisar ANTES de saber o resultado é de propósito: a sala já está
  // correndo contra o relógio do servidor desde o instante em que o
  // publisher sumiu — esperar a decisão seria avisar tarde. Um aviso que
  // no fim não for usado não custa nada: se a live cair mesmo, o
  // renderer derruba sala e ingress explicitamente (ver teardownRoom).
  if (activeRoomCode && isFollowingAutoWindow()) {
    notifyRoomReconnecting(activeRoomCode)
  }

  let recovering = false
  try {
    recovering = await tryRecoverFromExit(mainWindow)
  } catch (err) {
    logGstreamer(`erro ao tentar recuperar a transmissão: ${err}`)
  }

  if (!recovering) {
    stopFollowing()
    mainWindow.webContents.send('gstreamer:exited', { code })
    return
  }

  followRecovery = {
    exitCode: code,
    timer: setTimeout(() => {
      logGstreamer(
        'a troca de janela pedida depois da morte do processo não veio a tempo — ' +
          'derrubando a transmissão'
      )
      finishFailedRecovery(mainWindow)
    }, FOLLOW_RECOVERY_TIMEOUT_MS)
  }
}

// Mata o processo atual, se existir, e espera ele sair de verdade antes
// de devolver — sem esperar, um `spawn` logo em seguida corre o risco de
// tentar recapturar o mesmo monitor/janela antes do Windows liberar o
// handle da Desktop Duplication API do processo anterior. Não dispara
// `gstreamer:exited` pro renderer (`removeAllListeners` antes do kill) —
// esse evento é só pra avisar de morte INESPERADA; aqui a morte é
// deliberada (parte de update() ou de um novo start()).
function killCurrentProcess(): Promise<void> {
  return new Promise((resolve) => {
    if (!gstProcess) {
      resolve()
      return
    }
    const proc = gstProcess
    gstProcess = null
    proc.removeAllListeners('exit')
    proc.removeAllListeners('error')
    proc.once('exit', () => resolve())
    proc.once('error', () => resolve())
    proc.kill()
  })
}

// Sobe o processo com uma fonte JÁ resolvida (ver resolveCaptureArg) —
// compartilhado entre `gstreamer:start` e `gstreamer:update` (item 13).
// A resolução da fonte acontece ANTES de chamar isso (e antes de matar
// o processo atual, no caso do update) de propósito: se a fonte NOVA
// falhar (monitor/janela não encontrado), a transmissão atual continua
// intacta, em vez de morrer pra dar lugar a uma que nem chegou a subir.
async function startPipeline(
  mainWindow: BrowserWindow,
  params: StartParams,
  captureArg: { name: string; value: string; windowPid?: number }
): Promise<{ ok: boolean }> {
  const exePath = resolveGstLaunchPath()
  const audioLoopbackArgs = await resolveAudioLoopbackArgs(captureArg.windowPid)
  const args = buildArgs({
    whipUrl: params.whipUrl,
    streamKey: params.streamKey,
    maxBitrateKbps: Math.round(params.bitrateKbps * BITRATE_PEAK_FACTOR),
    captureArgName: captureArg.name,
    captureArgValue: captureArg.value,
    width: params.width,
    height: params.height,
    fps: params.fps,
    bitrateKbps: params.bitrateKbps,
    audioLoopbackArgs
  })
  const bundledRoot = resolveBundledGstreamerRoot()
  logGstreamer(`iniciando: ${exePath} ${args.join(' ')}`)
  // Qual GStreamer está sendo usado é a PRIMEIRA coisa a saber quando a
  // transmissão não sobe — e a única forma de distinguir "faltou um
  // plugin no conjunto embarcado" de "o do sistema está estranho".
  logGstreamer(
    bundledRoot
      ? `GStreamer EMBARCADO em: ${bundledRoot}`
      : 'GStreamer DO SISTEMA (nenhum conjunto embarcado encontrado)'
  )
  logGstreamer(`log completo em: ${getGstreamerLogPath()}`)

  const child = spawn(exePath, args, { env: gstreamerEnv() })
  gstProcess = child

  // O PIPELINE ESTÁ RODANDO (2026-10-13, pedido do usuário: "fast start")
  //
  // Até esta data a tela de iniciar segurava a pessoa até o SERVIDOR
  // publicar a sala — o último dos oito passos de uma live subindo, e o
  // que mais depende de rede (negociação WHIP, webhook do LiveKit
  // chegando ao prisma_server). Davam 4 a 6 segundos de spinner.
  //
  // Esta linha é o passo CINCO, e é um sinal de verdade: quando o
  // `gst-launch` a escreve, a fonte abriu, o encoder existe e os
  // elementos linkaram — que é tudo o que pode dar errado por aqui. O
  // que falta dali em diante é rede, e é feito em segundo plano com a
  // Home já na tela.
  //
  // Por que não o passo QUATRO (o `spawn` ter dado certo): ele prova
  // apenas que um processo nasceu. Era o comportamento de antes de
  // 2026-10-02, e o problema dele era exatamente este — a Home aparecia
  // com a live no ar e, um segundo depois, o erro de um pipeline que
  // nunca montou.
  //
  // UMA VEZ SÓ por processo. O `gst-launch` escreve a linha na subida, e
  // um `update` (troca de fonte) mata este processo e sobe outro — que
  // avisa de novo, pelo seu próprio listener. Quem espera do outro lado
  // já se desarmou (ver `start` em useGstreamerTransmission.ts).
  const MARCA_PLAYING = 'Setting pipeline to PLAYING'
  let avisouPlaying = false
  // A sobra do chunk anterior, pra não perder a marca partida no meio.
  // O stdout chega em pedaços do tamanho que o SO entregar, e nada
  // garante que uma linha caia inteira num deles — guardar os últimos
  // caracteres e procurar na emenda custa nada e fecha essa fresta.
  let rabo = ''
  child.stdout.on('data', (chunk) => {
    logGstreamer(`stdout: ${chunk}`)
    if (avisouPlaying) return
    const texto = rabo + String(chunk)
    if (!texto.includes(MARCA_PLAYING)) {
      rabo = texto.slice(-MARCA_PLAYING.length)
      return
    }
    avisouPlaying = true
    rabo = ''
    logGstreamer('pipeline em PLAYING — avisando o renderer (fast start)')
    mainWindow.webContents.send('gstreamer:playing', { roomCode: params.roomCode })
  })
  child.stderr.on('data', (chunk) => logGstreamer(`stderr: ${chunk}`))
  // Os dois handlers abaixo só rodam numa morte INESPERADA: o
  // `killCurrentProcess()` (usado pelo stop e pelo update) remove os
  // listeners antes de matar, justamente pra uma troca de fonte não
  // parecer um crash. Daí o `stopFollowing()` poder morar aqui sem
  // desarmar o seguidor a cada troca automática que ele mesmo pediu.
  child.on('error', (err) => {
    logGstreamer(`erro ao iniciar processo: ${err.message}`)
    gstProcess = null
    stopFollowing()
    mainWindow.webContents.send('gstreamer:exited', { code: null, error: err.message })
  })
  child.on('exit', (code) => {
    logGstreamer(`processo encerrado, code=${code}`)
    gstProcess = null
    // Pode ser a janela do jogo fechando no fim da partida — nesse caso
    // a live é salva trocando de janela e o renderer nem fica sabendo
    // que o processo morreu. Ver handleUnexpectedExit.
    void handleUnexpectedExit(mainWindow, code)
  })

  return { ok: true }
}

export function setupGstreamerHandlers(mainWindow: BrowserWindow): void {
  // A FONTE É RESOLVIDA ENQUANTO A SALA NASCE (2026-10-16, "start
  // instantâneo")
  //
  // Achar o HWND/HMONITOR da fonte escolhida custa enumerações de janela
  // pelo helper nativo — centenas de milissegundos. Antes elas
  // aconteciam em fila: primeiro a detecção do que estava sendo
  // transmitido (que esperava antes até de pedir a sala), depois o
  // `createIngress`, e só então o `gstreamer:start` resolvia a fonte de
  // novo.
  //
  // Agora o renderer chama isto no clique, SEM esperar, e logo em
  // seguida pede a sala. As duas coisas correm juntas, e o
  // `gstreamer:start` só pega o resultado pronto.
  //
  // A detecção de JOGO saiu deste caminho de vez (pedido do usuário): a
  // sala nasce com o nome da janela ou do monitor, que o renderer já tem
  // da grade, e o jogo chega depois pelo polling de sempre (ver
  // handleTransmissionSourceChanged).
  ipcMain.handle('gstreamer:prepareSource', (_event, sourceId: string | null): void => {
    preparedSource = { sourceId, at: Date.now(), result: resolveCaptureArg(sourceId) }
    // Sem dono da promessa até o `start` chegar: uma rejeição aqui não
    // pode virar "unhandled". Quem a vê de verdade é o `start`, que
    // aguarda a mesma promessa.
    preparedSource.result.catch(() => undefined)
  })

  // UM START POR VEZ (2026-10-17). O `gstProcess` só é preenchido dentro
  // do `startPipeline`, depois de esperar a fonte — e nesse intervalo um
  // segundo pedido passaria pela checagem dele também, subindo DOIS
  // `gst-launch` capturando e enviando juntos (upload dobrado, e o
  // primeiro órfão: o "parar" só mata o que está no `gstProcess`). Esta
  // trava vale desde a primeira linha do pedido.
  let startInFlight = false

  ipcMain.handle(
    'gstreamer:start',
    async (_event, params: StartParams): Promise<{ ok: boolean; error?: string }> => {
      if (gstProcess || startInFlight) {
        return { ok: false, error: 'Já existe uma captura GStreamer em andamento.' }
      }
      startInFlight = true
      let captureArg: ResolvedCapture
      let result: { ok: boolean; error?: string }
      try {
        captureArg = await takePreparedSource(params.sourceId)
        if ('error' in captureArg) {
          return { ok: false, error: captureArg.error }
        }
        result = await startPipeline(mainWindow, params, captureArg)
      } finally {
        startInFlight = false
      }
      activeRoomCode = params.roomCode
      // Item 29 do roadmap (detectar jogo/janela em andamento): dispara
      // sem esperar (fire-and-forget) — não deve atrasar a confirmação de
      // que a transmissão começou. Erro aqui só fica no log do GStreamer,
      // nunca derruba a transmissão em si.
      handleTransmissionSourceChanged(mainWindow, params.roomCode, captureArg).catch((err) =>
        logGstreamer(`erro ao iniciar detecção de jogo/janela: ${err}`)
      )
      // Item 13 do roadmap, troca automática de janela (2026-09-10):
      // decide se essa fonte é uma
      // janela de jogo que pode ganhar uma "irmã" no meio da live (o
      // cliente do LoL virando a partida, e casos análogos). Separado da
      // detecção acima de propósito: aquela responde "que jogo está na
      // tela", essa responde "que janela a gente captura".
      handleFollowSourceChanged(mainWindow, params.sourceId, captureArg)
      return result
    }
  )

  // Item 13 do roadmap: troca resolução/FPS/fonte de uma live já no ar,
  // sem derrubar a SALA (o Ingress/roomName continuam os mesmos — quem
  // chama já reaproveita o mesmo whipUrl/streamKey do start() original,
  // ver useGstreamerTransmission.ts). Diferente do caminho antigo via
  // Chromium (replaceTrack, sem reconectar nada): o GStreamer não tem
  // como reconfigurar um pipeline já rodando, então isso mata o processo
  // atual e sobe um novo — o viewer vê uma reconexão rápida do
  // vídeo/áudio (TrackUnsubscribed/TrackSubscribed), não é 100%
  // transparente, mas a sala/participantes continuam os mesmos.
  ipcMain.handle(
    'gstreamer:update',
    async (_event, params: StartParams): Promise<{ ok: boolean; error?: string }> => {
      // `followRecovery` deixa passar o único caso legítimo de update
      // sem processo: a janela capturada fechou e o seguidor pediu a
      // troca pra janela original. A transmissão (sala e ingress)
      // continua viva — o que falta é justamente subir o pipeline.
      if (!gstProcess && !followRecovery) {
        return { ok: false, error: 'Nenhuma captura GStreamer em andamento pra atualizar.' }
      }
      // Resolve a fonte NOVA antes de tocar no processo atual — se
      // falhar (monitor/janela não encontrado), a transmissão em
      // andamento continua intacta.
      // Aceita uma enumeração de até 3s (2026-09-20): quando este update
      // vem do seguidor de janela, ele ACABOU de enumerar pra escolher
      // este HWND — refazer a pergunta custaria mais meio segundo de
      // live parada bem no meio da reconexão. Numa troca manual a lista
      // recente é igualmente boa: 3s não mudam se a janela escolhida
      // ainda existe (e se mudarem, o pipeline morre e cai no mesmo
      // tratamento de sempre).
      const captureArg = await resolveCaptureArg(params.sourceId, 3000)
      if ('error' in captureArg) {
        // Numa recuperação não há transmissão intacta pra preservar: o
        // processo já morreu. Avisa o renderer na hora, em vez de
        // deixar o timer de emergência contar 18s com a tela dizendo
        // "ao vivo".
        if (followRecovery) finishFailedRecovery(mainWindow)
        return { ok: false, error: captureArg.error }
      }
      // A partir daqui a sala fica sem publisher até o processo novo
      // negociar o WHIP — segundos em que o servidor, sem saber de nada,
      // a trataria como live abandonada e apagaria (ver roomReconnect.ts
      // pro bug real que isso causou). Numa recuperação o aviso já saiu
      // lá no handleUnexpectedExit; repetir é inofensivo (o servidor só
      // reagenda o prazo) e cobre a troca MANUAL de fonte, que chega
      // aqui direto.
      notifyRoomReconnecting(params.roomCode)
      logGstreamer('update: derrubando processo atual pra subir com os novos parâmetros')
      await killCurrentProcess()
      const result = await startPipeline(mainWindow, params, captureArg)
      if (followRecovery) {
        if (!result.ok) {
          finishFailedRecovery(mainWindow)
          return result
        }
        logGstreamer('transmissão recuperada na janela original')
        clearFollowRecovery()
      }
      activeRoomCode = params.roomCode
      // Reinicia a detecção/reporte de jogo-ou-janela do zero pra fonte
      // nova — cobre tanto trocar de monitor pra janela (ou vice-versa)
      // quanto só trocar de monitor (o polling recomeça, mas o jogo
      // detectado tende a ser o mesmo).
      handleTransmissionSourceChanged(mainWindow, params.roomCode, captureArg).catch((err) =>
        logGstreamer(`erro ao atualizar detecção de jogo/janela: ${err}`)
      )
      // Mesma chamada do start, e é aqui que ela distingue os dois casos:
      // se esse update FOI o seguidor pedindo a troca, ele só confirma;
      // se foi o usuário mexendo no modal de fonte, o automático é
      // desarmado e recomeça do zero a partir da escolha nova.
      handleFollowSourceChanged(mainWindow, params.sourceId, captureArg)
      return result
    }
  )

  ipcMain.handle('gstreamer:stop', async (): Promise<{ ok: boolean }> => {
    // 2026-08-31: antes era "atira e esquece" (kill() sem esperar o
    // processo morrer de verdade) — o stop() do renderer já manda
    // deleteIngress/deleteRoom LOGO em seguida (ver
    // useGstreamerTransmission.ts), então corria contra o próprio
    // gst-launch ainda vivo por uma fração de segundo. Reaproveita
    // killCurrentProcess() (mesma função do update(), item 13) que espera
    // o evento 'exit' antes de resolver — não elimina o atraso do lado do
    // LiveKit em perceber que o publisher sumiu (isso é detecção de
    // timeout de rede, fora do nosso controle), mas garante que pelo
    // menos o processo local já morreu antes da gente sequer tentar.
    await killCurrentProcess()
    // Parou no meio de uma recuperação: não há mais nada a recuperar, e
    // o timer não pode disparar depois avisando de uma morte que o
    // usuário já resolveu parando a live.
    clearFollowRecovery()
    const stoppedRoomCode = activeRoomCode
    activeRoomCode = null
    // Item 29: limpa o jogo/janela reportado (fire-and-forget, mesmo
    // espírito do resto desse handler — não precisa travar a resposta
    // esperando o token-server confirmar).
    stopGameDetection(mainWindow, stoppedRoomCode).catch((err) =>
      logGstreamer(`erro ao limpar detecção de jogo/janela: ${err}`)
    )
    stopFollowing()
    return { ok: true }
  })
}

// Roadmap item 45 — bug real corrigido (2026-09-03): tentativas
// limitadas (não infinitas como o teardownRoom() do renderer, ver
// useGstreamerTransmission.ts — esse caminho aqui só roda quando JÁ
// estamos fechando o app à força, não dá pra insistir pra sempre) antes
// de desistir e deixar o app fechar mesmo assim. `index.ts` ainda tem um
// teto próprio (forceCloseTimeout) por cima disso, então mesmo se as 3
// tentativas aqui demorassem o máximo possível, o app não fica travado
// indefinidamente.
const APP_QUIT_TEARDOWN_MAX_ATTEMPTS = 3
const APP_QUIT_TEARDOWN_RETRY_DELAY_MS = 1200

async function teardownRoomForAppQuit(roomCode: string): Promise<void> {
  for (let attempt = 1; attempt <= APP_QUIT_TEARDOWN_MAX_ATTEMPTS; attempt++) {
    const ingressOk = await deleteIngress(roomCode)
    const roomOk = await deleteRoom(roomCode)
    if (ingressOk && roomOk) {
      logGstreamer(
        `app fechando: ingress/sala ${roomCode} derrubados com sucesso (tentativa ${attempt})`
      )
      return
    }
    if (attempt < APP_QUIT_TEARDOWN_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, APP_QUIT_TEARDOWN_RETRY_DELAY_MS))
    }
  }
  logGstreamer(
    `app fechando: NÃO foi possível confirmar que ingress/sala ${roomCode} caíram depois de ` +
      `${APP_QUIT_TEARDOWN_MAX_ATTEMPTS} tentativas — o app vai fechar mesmo assim (ver teto em index.ts)`
  )
}

// Chamado quando a janela do app é fechada (evento 'close' do
// BrowserWindow, ver index.ts).
//
// Bug real corrigido (2026-09-03, ROADMAP.md item 45): antes disparava
// deleteIngress/deleteRoom sem esperar resposta (`.kill()` sozinho já
// bastava pra achar que tinha "feito o suficiente") e devolvia na hora —
// quem chamava (`index.ts`) já mandava `mainWindow.close()` na sequência,
// sem NENHUMA garantia de que aquelas chamadas de rede chegassem no
// token-server antes do processo Electron morrer de verdade. Agora
// espera o processo GStreamer morrer de verdade (`killCurrentProcess()`,
// mesma função usada em stop()/update()) e tenta de verdade derrubar
// ingress/sala (com retry limitado, ver teardownRoomForAppQuit acima)
// antes de devolver — quem chama (`index.ts`) só fecha a janela depois
// que essa Promise resolver (ou um teto próprio, pra nunca travar o
// fechamento do app indefinidamente esperando rede).
export async function stopForAppQuit(): Promise<void> {
  stopGameDetectionForAppQuit()
  stopFollowing()
  // O app está fechando: uma recuperação em andamento não tem mais pra
  // onde ir, e o timer dela tentaria falar com uma janela destruída.
  clearFollowRecovery()
  await killCurrentProcess()
  if (activeRoomCode) {
    const roomCode = activeRoomCode
    activeRoomCode = null
    logGstreamer(`app fechando: derrubando ingress/sala ${roomCode}`)
    await teardownRoomForAppQuit(roomCode)
  }
}

// Usado por index.ts (evento 'close' da janela) pra saber se precisa
// segurar o fechamento do app e mostrar o diálogo "Parando
// transmissão..." (pedido do usuário, 2026-08-31) — se não tem
// transmissão ativa, fecha na hora, sem diálogo nenhum.
export function isTransmitting(): boolean {
  return activeRoomCode !== null
}
