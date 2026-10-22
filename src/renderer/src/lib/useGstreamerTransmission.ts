import { useEffect, useRef, useState } from 'react'
import { NowPlayingInfo } from './nowPlaying'
import {
  RESOLUTION_DIMENSIONS,
  TransmissionSettings,
  videoMaxBitrate
} from './transmissionSettings'
import { getErrorMessage } from './errors'
import { playSound } from './sounds'
import { claimHostRoom, releaseHostRoom, teardownTransmission } from './hostRoom'

// Item novo do roadmap ("Live via GStreamer"): caminho alternativo de
// transmissão, fora do Chromium — o `getDisplayMedia` mede ~45fps mesmo na
// área de trabalho (ver MEMORIA.md), então essa é a via de captura via
// GStreamer (Desktop Duplication API + Media Foundation H264 por GPU),
// publicando via WHIP direto num LiveKit Ingress.
//
// Reaproveita a MESMA tela de configuração de sempre (`TransmissionScreen.tsx`,
// itens 9/10/11 do roadmap) — resolução/FPS/fonte escolhidos ali viram,
// respectivamente, largura/altura (`RESOLUTION_DIMENSIONS`), o `framerate`
// do capsfilter, e o bitrate do encoder (`VIDEO_MAX_BITRATE` — nunca
// deixamos o bitrate livre). A resolução de qual monitor/janela captar de
// verdade (HMONITOR/HWND) acontece no main, ver gstreamerCapture.ts.
//
// Esse hook NUNCA abre uma Room do livekit-client pra publicar — quem
// publica é o processo GStreamer (via WHIP no Ingress), não o Electron. O
// app só cria/derruba a sala e o ingress, e gerencia o processo GStreamer
// (tudo via IPC pro main). O livekit-client continua sendo usado, só que
// exclusivamente do lado de quem ASSISTE (useViewer.ts).
//
// O CÓDIGO DA SALA saiu daqui em 2026-10-20 (item 26, webcam): a sala é do
// host e pode receber a tela E a webcam, então quem gera o código, e
// decide quando a sala acaba, é o registro em hostRoom.ts.

// Pedido do usuário (2026-08-31, ver ROADMAP.md item 18): `deleteIngress`/
// `deleteRoom` devolvem se derrubaram de verdade (ver src/main/livekit.ts)
// — insiste, tentando de novo a cada 2s, até as duas confirmarem. Extraído
// de dentro de stop() pra ser reaproveitado também quando o GStreamer
// morre sozinho com uma sala ainda ativa (ver onExited abaixo).
//
// ---------------------------------------------------------------------
// COM TETO DESDE 2026-09-18, e o motivo veio de um caso real.
//
// Era `for (;;)`, sem limite. A ideia era boa enquanto toda falha fosse
// passageira: insistir até confirmar. Mas apareceu uma falha PERMANENTE
// — a sala ficou órfã no LiveKit (registro no Redis apontando pra um nó
// que sumiu), e o `deleteRoom` passou a responder "could not find
// object" em toda tentativa, pra sempre.
//
// O resultado foi o pior tipo de travamento: a UI presa em "Parando
// transmissão..." sem saída, e um pedido a cada 2 segundos indo pro
// servidor por tempo indeterminado. Insistir eternamente contra algo que
// nunca vai mudar não é robustez, é um laço infinito com outro nome.
//
// Vinte segundos aguentam qualquer tropeço de rede; o que passa disso
// não é tropeço. Desistindo, a transmissão local JÁ morreu (o processo
// do GStreamer foi encerrado antes disto), e uma sala que sobre no
// LiveKit sem ninguém publicando é recolhida pelo `empty_timeout` dele.
// ---------------------------------------------------------------------
// QUANDO A LIVE PASSA A EXISTIR PRA QUEM TRANSMITE (2026-10-13, pedido
// do usuário: "fast start")
//
// Subir uma live são oito passos, e os quatro últimos são rede: a
// negociação WHIP, o publisher entrando na sala do LiveKit, o webhook
// chegando ao prisma_server e a sala voltando em broadcast. Entre
// 2026-10-02 e esta data a tela de iniciar segurava a pessoa até o
// ÚLTIMO deles — 4 a 6 segundos de spinner.
//
// Agora ela espera o passo CINCO: o `gst-launch` anunciando que o
// pipeline está em PLAYING (ver startPipeline em
// src/main/gstreamerCapture.ts). Dali pra frente a Home já está na tela
// e o resto acontece em segundo plano.
//
// Isso NÃO mostra live quebrada pra ninguém: o servidor só publica a
// sala pra outras pessoas quando o primeiro publisher entra de verdade
// (`markRoomReady` no server.js). Adiantar o que o HOST vê é adiantar
// só o que ele vê — quem assiste continua esperando a live existir.
//
// ⚠️ SUPERADO EM 2026-10-16 ("start instantâneo", ver start()): a live
// agora aparece pro host NO CLIQUE, e pros outros assim que a sala é
// criada, antes do vídeo. Esta espera sobrou só pra apagar o "iniciando"
// do selo do rodapé e pra saber se a qualidade deve ser lembrada.
type PipelineOutcome =
  // O pipeline está rodando: fonte aberta, encoder vivo, elementos
  // linkados. É o sinal que faz a Home aparecer.
  | 'playing'
  // O processo morreu antes disso. Quem derruba a sala e avisa é o
  // `onExited` lá embaixo; aqui é só não comemorar.
  | 'failed'
  // Teto estourado. NÃO é sinônimo de falha — o pipeline pode estar
  // rodando e a linha ter se perdido. Quem chama segue em frente: um
  // spinner eterno seria pior que uma live que apareceu sem aviso.
  | 'timeout'

// Vinte segundos, o mesmo teto do teardown logo abaixo. O pipeline leva
// ~1,2s nesta máquina (1s disso é o plugin de MediaFoundation
// carregando); o que passar muito disso não é lentidão, é outra coisa.
const PIPELINE_TIMEOUT_MS = 20000

// Derruba a TELA: o ingress dela e, se ela era a última transmissão do
// host, a sala inteira (2026-10-20 — com a webcam no ar, a sala fica). O
// laço com teto descrito acima mora agora em `teardownTransmission`
// (hostRoom.ts), que a webcam usa também.
//
// `releaseHostRoom` aqui, no INSTANTE da decisão, e não depois de matar o
// processo: é isso que faz parar as duas juntas derrubar a sala uma vez.
function teardownRoom(code: string): Promise<boolean> {
  const { lastOne } = releaseHostRoom('screen')
  return teardownTransmission(code, 'screen', lastOne)
}

interface UseGstreamerTransmissionResult {
  transmitting: boolean
  // true entre clicar em "Parar" e a sala ser confirmada derrubada de
  // verdade (2026-08-31, ver stop() abaixo) — HomeScreen usa isso pra
  // mostrar "Parando transmissão..." no footer em vez dos controles
  // normais.
  stopping: boolean
  roomCode: string | null
  settings: TransmissionSettings | null
  error: string | null
  // Item 29 do roadmap: jogo (Steam/lista do Discord) ou título da janela
  // sendo transmitida agora — atualizado via push do main (main/
  // gameDetection.ts), não dá pra descobrir isso pela lista de salas (a
  // própria live nunca aparece nela pro host, ver ROADMAP.md item 18).
  nowPlaying: NowPlayingInfo | null
  // Quando o app começou a contar esta live (epoch ms), marcado no
  // instante em que o pipeline entrou em PLAYING.
  //
  // É um relógio LOCAL e provisório: o oficial é o `startedAt` que o
  // LiveKit grava na sala e que chega pela lista de salas alguns
  // instantes depois (ver RoomInfo em useRooms.ts). O cronômetro do
  // rodapé usa este até o outro chegar e então troca — a diferença é de
  // 1 a 2 segundos e se resolve sozinha, enquanto um campo vazio no
  // lugar do tempo apareceria justo quando a pessoa olha pra ele.
  startedAt: number | null
  // Entre o clique em "Compartilhar tela" e o pipeline rodando
  // (2026-10-16). A live já aparece pro host nesse intervalo; isto é o
  // que deixa o selo do rodapé em "iniciando".
  launching: boolean
  // A sala já existe no servidor (o `createIngress` respondeu). Antes
  // disso não há onde o preview do host se conectar.
  roomOpen: boolean
  // Marca a live como no ar NA HORA e faz o resto em segundo plano
  // (2026-10-16) — ver o comentário em start(). A promessa só responde
  // quando o pipeline está rodando, e quem chama não precisa esperá-la.
  start: (
    settings: TransmissionSettings,
    participantName: string,
    initialNowPlaying: NowPlayingInfo | null
  ) => Promise<boolean>
  // Item 13 do roadmap: troca resolução/FPS/fonte sem derrubar a sala —
  // reaproveita o whipUrl/streamKey do start() original (guardados em
  // ingressRef), nunca chama createIngress/getToken de novo.
  update: (settings: TransmissionSettings) => Promise<boolean>
  stop: () => Promise<void>
}

// onStartError: falha ao iniciar uma transmissão nova — pedido do usuário
// pra virar um snackbar em vez de texto fixo na tela. Desde 2026-10-16
// cobre também o update(): o dialog de atualizar fecha no clique, então
// não sobra tela nenhuma onde mostrar o erro inline.
export function useGstreamerTransmission(
  onStartError?: (message: string) => void
): UseGstreamerTransmissionResult {
  const [transmitting, setTransmitting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [settings, setSettings] = useState<TransmissionSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [launching, setLaunching] = useState(false)
  const [roomOpen, setRoomOpen] = useState(false)

  // Item 29 do roadmap — main empurra toda vez que o jogo/janela detectado
  // muda (ver gameDetection.ts); null tanto quando nada foi detectado
  // ainda quanto quando a transmissão parou.
  useEffect(() => window.api.games.onNowPlayingUpdate(setNowPlaying), [])

  // Guardado à parte do estado React — usado pelo update() pra saber
  // pra onde publicar sem precisar criar um ingress novo. Vive numa ref
  // (não state) porque nunca precisa disparar re-render sozinho.
  const ingressRef = useRef<{ whipUrl: string; streamKey: string } | null>(null)

  // "Parar" chegou com o início ainda em andamento (2026-10-16). Lido
  // pelo `start` entre um passo e outro, pra não lançar o pipeline de
  // uma live que já foi encerrada.
  const abortStartRef = useRef(false)
  // O início em andamento, até o processo do GStreamer estar lançado —
  // é o que o `stop` espera antes de derrubar qualquer coisa.
  const launchRef = useRef<Promise<unknown> | null>(null)
  // Já existe uma live desta sessão, subindo ou no ar (2026-10-17). Uma
  // ref, e não o `transmitting`, porque um segundo clique pode chegar
  // antes do render que o atualiza — e um segundo `start` sobrescreveria
  // o código de sala do primeiro, deixando o processo dele órfão.
  const liveActiveRef = useRef(false)

  // Tudo o que diz "estou transmitindo", de volta ao repouso. Não mexe
  // no `stopping` nem no `error`: esses são de quem chama.
  function resetLocalState(): void {
    liveActiveRef.current = false
    ingressRef.current = null
    setTransmitting(false)
    setLaunching(false)
    setRoomOpen(false)
    setSettings(null)
    setRoomCode(null)
    setStartedAt(null)
    setNowPlaying(null)
  }

  // Espelha `roomCode` numa ref — o handler de onExited (efeito com deps
  // vazias, registrado uma única vez) precisa do valor MAIS RECENTE no
  // momento em que o processo morre, não do valor capturado no fechamento
  // de quando o efeito montou (que ficaria sempre null).
  const roomCodeRef = useRef<string | null>(null)
  useEffect(() => {
    roomCodeRef.current = roomCode
  }, [roomCode])

  // Quem está esperando o pipeline subir, se alguém estiver.
  //
  // Uma ref e não estado: ninguém precisa re-renderizar por causa disto,
  // e o `onPlaying`/`onExited` (efeitos que montam UMA vez) precisam
  // enxergar o valor do momento em que o evento chega, não o do render
  // em que foram registrados.
  const esperaPipelineRef = useRef<((outcome: PipelineOutcome) => void) | null>(null)

  // Responde a espera UMA vez só — o primeiro dos três caminhos
  // (pipeline rodando, processo morto, teto) ganha, e os outros não
  // encontram mais ninguém pra responder.
  function resolverEspera(outcome: PipelineOutcome): void {
    const settle = esperaPipelineRef.current
    if (!settle) return
    esperaPipelineRef.current = null
    settle(outcome)
  }

  useEffect(() => {
    return window.api.gstreamer.onPlaying(() => resolverEspera('playing'))
    // Sem deps: monta uma vez e fala com a ref, que está sempre em dia.
  }, [])

  // `stop()` marca essa ref antes de matar o processo de propósito — sem
  // isso, o próprio `kill()` (abaixo) dispara esse mesmo evento de saída
  // (com code != 0, já que foi terminado à força) e a gente acabava
  // mostrando um "encerrou inesperadamente" logo depois do usuário clicar
  // em parar.
  const expectingStopRef = useRef(false)

  // Se o processo GStreamer morrer sozinho (pipeline inválido, plugin
  // faltando, falha de negociação WHIP, ou — item novo do roadmap — a
  // JANELA capturada foi fechada), o `start()` já tinha devolvido sucesso
  // otimisticamente — sem tratar isso, a UI ficaria travada mostrando "ao
  // vivo" com o processo já morto E a sala continuaria viva no LiveKit
  // sem ninguém publicando, prendendo os viewers do outro lado vendo
  // "Aguardando transmissão" pra sempre. Derruba a sala/ingress do mesmo
  // jeito que um stop() manual (mesmo retry indefinido, ver
  // teardownRoom), só que disparado sozinho em vez de por um clique.
  useEffect(() => {
    return window.api.gstreamer.onExited((info) => {
      const crashedRoomCode = roomCodeRef.current
      const wasExpected = expectingStopRef.current
      expectingStopRef.current = false

      // Antes de qualquer outra coisa: quem estiver esperando o pipeline
      // subir precisa saber que não vai subir mais. Sem isto, a tela de
      // iniciar ficaria girando até o teto de 20s por uma live que já
      // morreu.
      resolverEspera('failed')

      liveActiveRef.current = false
      setTransmitting(false)
      setLaunching(false)
      setRoomOpen(false)
      setSettings(null)
      setNowPlaying(null)
      setStartedAt(null)
      ingressRef.current = null

      if (wasExpected || !crashedRoomCode) {
        // Morte inesperada antes de o código chegar à ref: a vaga da tela
        // na sala do host ainda está tomada, e precisa ser devolvida.
        if (!wasExpected) releaseHostRoom('screen')
        setRoomCode(null)
        if (!wasExpected && info.code !== 0) {
          const message =
            info.error ?? `GStreamer encerrou inesperadamente (código ${info.code ?? '?'})`
          setError(message)
          onStartError?.(message)
        }
        return
      }

      const message =
        info.error ??
        'A transmissão foi encerrada inesperadamente (a janela capturada pode ter sido fechada, ou o GStreamer travou) — a sala foi encerrada.'
      setError(message)
      onStartError?.(message)
      setStopping(true)
      teardownRoom(crashedRoomCode).finally(() => {
        setRoomCode(null)
        setStopping(false)
      })
    })
    // onStartError fica de fora de propósito (efeito monta uma vez só) —
    // em App.tsx é `(message) => snackbar.show(...)`, fechando sobre um
    // `show` estável (useCallback em useSnackbar.ts), então a versão
    // capturada no mount continua funcionando normalmente mesmo sem
    // re-capturar a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Arma a espera ANTES de mandar subir o pipeline: o aviso de PLAYING
  // chega por um canal próprio (ver onPlaying), e não há garantia de
  // ordem entre ele e a resposta do `gstreamer:start`. Armar depois
  // seria deixar uma fresta pra perder o aviso e esperar os 20s inteiros
  // por nada.
  function esperarPipeline(): Promise<PipelineOutcome> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolverEspera('timeout'), PIPELINE_TIMEOUT_MS)
      esperaPipelineRef.current = (outcome) => {
        clearTimeout(timer)
        resolve(outcome)
      }
    })
  }

  // O QUE ACONTECE NO CLIQUE EM "COMPARTILHAR TELA" (2026-10-16, pedido
  // do usuário: "start instantâneo")
  //
  // Antes a tela de iniciar segurava a pessoa até o pipeline entrar em
  // PLAYING (~1,4s), e a sala só aparecia pros outros depois do primeiro
  // frame. Agora a ordem de prioridade é a do usuário:
  //
  //   1. NA HORA, no próprio clique: a live passa a existir pro HOST — o
  //      dialog fecha, o rodapé mostra a ficha com o timer contando e o
  //      nome da janela/monitor. Nada disto espera rede.
  //   2. Logo em seguida, o pedido da sala ao servidor. Ele a cria já com
  //      host, timer e o que está sendo transmitido, e a publica pra
  //      todo mundo no `room_started` (ver o server.js), sem esperar o
  //      vídeo.
  //   3. Em segundo plano, o resto: a fonte (resolvida em paralelo com o
  //      passo 2, ver 'gstreamer:prepareSource'), o pipeline, o WHIP.
  //
  // Quem entrar na sala entre o 2 e o 3 vê "Aguardando transmissão" até
  // o vídeo chegar — aceito pelo usuário. O que NÃO pode acontecer é a
  // sala ficar de pé se o 3 falhar, e por isso todo caminho de falha
  // daqui derruba a sala (ver `falhar`).
  //
  // A promessa devolve quando o pipeline está rodando (ou falhou) — quem
  // chama NÃO espera por ela pra fechar o dialog; ela só serve pra saber
  // se a qualidade escolhida deve ser lembrada.
  async function start(
    newSettings: TransmissionSettings,
    participantName: string,
    // O que a grade já sabe da fonte: o nome da janela (com o ícone do
    // programa) ou do monitor. Vai junto da criação da sala — o jogo, se
    // houver, chega depois pelo polling de sempre (gameDetection.ts).
    initialNowPlaying: NowPlayingInfo | null
  ): Promise<boolean> {
    if (liveActiveRef.current) return false
    liveActiveRef.current = true
    setError(null)
    // A sala do host (2026-10-20): nova, ou a que a webcam já abriu —
    // aí o servidor vincula a tela a ela, e a privacidade é a da sala.
    const { code } = claimHostRoom('screen', newSettings.private)
    const { width, height } = RESOLUTION_DIMENSIONS[newSettings.resolution]
    const bitrateKbps = Math.round(videoMaxBitrate(newSettings.resolution, newSettings.fps) / 1000)

    // Uma live nova começa sem nenhum resto da anterior: um `stop` que
    // tenha chegado durante um início que falhou deixaria isto armado, e
    // a próxima queda de verdade seria lida como "parada de propósito".
    abortStartRef.current = false
    expectingStopRef.current = false
    ingressRef.current = null

    // 1. A LIVE EXISTE PRO HOST.
    setSettings(newSettings)
    setRoomCode(code)
    setRoomOpen(false)
    setLaunching(true)
    setTransmitting(true)
    setNowPlaying(initialNowPlaying)
    // O relógio local, do clique. O oficial (a criação da sala no
    // LiveKit) chega pela lista de salas uns milissegundos depois e é
    // praticamente o mesmo instante — ver `startedAt` no contrato.
    setStartedAt(Date.now())
    // Pedido do usuário (2026-09-06): confirmação sonora de que a live
    // subiu. Desde 2026-10-16 ela "sobe" no clique, então o som também.
    //
    // NÃO passa pela preferência `alertForNewLives`: ela desliga o alerta
    // de lives DOS OUTROS aparecendo na lista (decisão confirmada com o
    // usuário). Este som é resposta a um clique do próprio usuário.
    playSound('newLive')

    // 3, adiantado: a fonte começa a ser resolvida JÁ, enquanto a sala é
    // pedida. Sem `await` de propósito.
    void window.api.gstreamer.prepareSource(newSettings.sourceId)

    // Desfaz tudo o que o passo 1 mostrou e derruba a sala no servidor.
    // A sala pode já estar na lista de todo mundo, então derrubá-la não é
    // opcional — é o que impede uma live sem vídeo de ficar de pé.
    function falhar(message: string): void {
      setError(message)
      onStartError?.(message)
      resetLocalState()
      // Sem `await`: a pessoa já recebeu o aviso e o app já voltou ao
      // normal. A sala some da lista dela pelo useHiddenOwnRoomCode
      // enquanto isso termina.
      void teardownRoom(code)
    }

    // O que precisa terminar antes de um `stop` poder agir: até o
    // processo do GStreamer estar lançado (ou não ir ser mais). Ver
    // `stop()` — sem esperar isto, um "parar" no meio do início mataria
    // um processo que ainda não existe, e o que nascesse depois ficaria
    // órfão, publicando numa sala derrubada.
    // Devolve, quando o processo foi lançado, a espera do pipeline que ele
    // armou — é por ela que o resto deste `start` aguarda.
    type Launch =
      | { status: 'launched'; pipelinePronto: Promise<PipelineOutcome> }
      | {
          status: 'aborted' | 'failed'
        }
    const launch = (async (): Promise<Launch> => {
      try {
        // 2. A SALA.
        const { url, streamKey } = await window.api.livekit.createIngress({
          roomName: code,
          participantName,
          private: newSettings.private,
          game: initialNowPlaying,
          source: 'screen'
        })
        // Parou enquanto a sala era criada: quem derruba é o `stop`, que
        // está esperando esta promessa pra fazer isso.
        if (abortStartRef.current) return { status: 'aborted' }

        ingressRef.current = { whipUrl: url, streamKey }
        setRoomOpen(true)

        // Armada ANTES de mandar subir o pipeline — ver esperarPipeline.
        const pipelinePronto = esperarPipeline()

        // 3. O PIPELINE.
        const result = await window.api.gstreamer.start({
          roomCode: code,
          whipUrl: url,
          streamKey,
          sourceId: newSettings.sourceId,
          width,
          height,
          fps: newSettings.fps,
          bitrateKbps
        })
        if (!result.ok) {
          // A captura nem chegou a ser lançada: ninguém vai avisar nada,
          // então a espera armada acima tem que ser desfeita na mão.
          resolverEspera('failed')
          falhar(result.error ?? 'Erro ao iniciar captura via GStreamer')
          return { status: 'failed' }
        }
        return { status: 'launched', pipelinePronto }
      } catch (err) {
        // Pode ter estourado DEPOIS de a espera ser armada. Sem isto o
        // teto de 20s dela ficaria pendurado e, quando disparasse,
        // responderia a espera de uma segunda tentativa de iniciar. É um
        // no-op quando a falha veio antes de armar.
        resolverEspera('failed')
        if (abortStartRef.current) return { status: 'aborted' }
        falhar(getErrorMessage(err, 'Erro ao iniciar live via GStreamer'))
        return { status: 'failed' }
      }
    })()
    launchRef.current = launch

    const launched = await launch
    if (launchRef.current === launch) launchRef.current = null
    if (launched.status !== 'launched') return false

    // O GStreamer pode morrer no meio da subida. O `onExited` lá em cima
    // já derruba a sala e avisa o usuário — aqui é só não comemorar.
    const outcome = await launched.pipelinePronto
    if (outcome === 'failed') return false

    // 'playing' ou 'timeout' (ver PipelineOutcome): a ficha do rodapé
    // para de dizer "iniciando".
    setLaunching(false)
    return true
  }

  async function update(newSettings: TransmissionSettings): Promise<boolean> {
    if (!roomCode) return false
    // Desde 2026-10-16 a live aparece pro host antes de o ingress
    // existir — o modal de definições já pode ser aberto nesse
    // intervalo de um ou dois segundos.
    if (!ingressRef.current || launching) {
      const message = 'A transmissão ainda está iniciando. Tente de novo em instantes.'
      setError(message)
      onStartError?.(message)
      return false
    }
    setError(null)
    const { width, height } = RESOLUTION_DIMENSIONS[newSettings.resolution]
    const bitrateKbps = Math.round(videoMaxBitrate(newSettings.resolution, newSettings.fps) / 1000)

    try {
      const result = await window.api.gstreamer.update({
        roomCode,
        whipUrl: ingressRef.current.whipUrl,
        streamKey: ingressRef.current.streamKey,
        sourceId: newSettings.sourceId,
        width,
        height,
        fps: newSettings.fps,
        bitrateKbps
      })
      if (!result.ok) {
        const message = result.error ?? 'Erro ao atualizar a transmissão'
        setError(message)
        onStartError?.(message)
        return false
      }

      setSettings(newSettings)
      return true
    } catch (err) {
      const message = getErrorMessage(err, 'Erro ao atualizar a transmissão')
      setError(message)
      onStartError?.(message)
      return false
    }
  }

  // Item 13 do roadmap, troca automática de janela (2026-09-10): o main
  // percebeu que o jogo abriu
  // uma janela nova — ou que a janela do jogo morreu — e pede a troca da
  // fonte (ver src/main/gameWindowFollow.ts, que explica por que ele não
  // reinicia o pipeline por conta própria).
  //
  // As duas refs existem porque o efeito abaixo monta UMA vez: tanto
  // `update` (que fecha sobre `roomCode`) quanto `settings` são estado,
  // e a versão capturada no mount ficaria presa pra sempre no valor de
  // antes da live começar — `settings` seria null e a troca nunca
  // aconteceria.
  const updateRef = useRef(update)
  const settingsRef = useRef<TransmissionSettings | null>(null)
  // Sem array de dependências de propósito: precisa rodar em TODO
  // render, é o que mantém as duas refs em dia.
  useEffect(() => {
    updateRef.current = update
    settingsRef.current = settings
  })

  useEffect(() => {
    return window.api.gstreamer.onAutoSourceChanged(({ sourceId }) => {
      const current = settingsRef.current
      // Sem transmissão no ar não há o que trocar. Na prática o main só
      // manda isso durante uma live, mas a corrida existe (parar a live
      // enquanto o evento está a caminho do renderer).
      if (!current) return
      // Só a FONTE muda — resolução, FPS e o resto continuam sendo o que
      // o usuário escolheu.
      void updateRef.current({ ...current, sourceId })
    })
  }, [])

  // Pedido do usuário (2026-08-31, ver ROADMAP.md item 18): antes essas
  // duas chamadas eram "atira e esquece" — se falhassem em silêncio
  // (bug real encontrado), a sala continuava viva no LiveKit sem
  // ninguém saber, e a UI já tinha voltado pro estado "parado". Agora
  // `deleteIngress`/`deleteRoom` devolvem se derrubaram de verdade (ver
  // src/main/livekit.ts) e essa função insiste, tentando de novo a cada
  // 2s, até as duas confirmarem — só aí a tela volta ao normal.
  async function stop(): Promise<void> {
    const code = roomCode
    expectingStopRef.current = true
    abortStartRef.current = true
    setStopping(true)

    // PARAR NO MEIO DO INÍCIO (2026-10-16). Com a live aparecendo no
    // clique, o botão de parar existe antes de a sala e o processo
    // existirem. Espera o início chegar num ponto firme — sala criada e
    // processo lançado, ou desistência — e só então derruba: matar
    // antes um processo que ainda vai nascer deixaria ele órfão,
    // publicando numa sala que acabou de ser derrubada.
    if (launchRef.current) await launchRef.current.catch(() => undefined)

    await window.api.gstreamer.stop()

    if (code) await teardownRoom(code)
    else releaseHostRoom('screen')

    resetLocalState()
    setStopping(false)
    // No fim de propósito: `stop()` fica em "Parando transmissão..."
    // enquanto insiste no teardown (pode levar segundos, ver o comentário
    // acima), então tocar aqui faz o som coincidir com a tela voltando ao
    // normal, e não com o clique.
    playSound('stopLive')
  }

  return {
    transmitting,
    stopping,
    roomCode,
    settings,
    error,
    nowPlaying,
    startedAt,
    launching,
    roomOpen,
    start,
    update,
    stop
  }
}
