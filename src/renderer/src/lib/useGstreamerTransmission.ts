import { useEffect, useRef, useState } from 'react'
import { NowPlayingInfo } from './nowPlaying'
import {
  RESOLUTION_DIMENSIONS,
  TransmissionSettings,
  VIDEO_MAX_BITRATE
} from './transmissionSettings'
import { getErrorMessage } from './errors'
import { playSound } from './sounds'

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
function generateRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

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
const TEARDOWN_MAX_ATTEMPTS = 10
const TEARDOWN_RETRY_MS = 2000

/** `true` se o servidor confirmou a queda; `false` se desistiu no teto. */
async function teardownRoom(code: string): Promise<boolean> {
  for (let attempt = 1; attempt <= TEARDOWN_MAX_ATTEMPTS; attempt++) {
    const ingressOk = await window.api.livekit.deleteIngress(code)
    const roomOk = await window.api.livekit.deleteRoom(code)
    if (ingressOk && roomOk) return true

    if (attempt === TEARDOWN_MAX_ATTEMPTS) {
      console.warn(
        `[teardown] desistindo de derrubar a sala ${code} depois de ` +
          `${TEARDOWN_MAX_ATTEMPTS} tentativas (ingress=${ingressOk}, sala=${roomOk}). ` +
          'A transmissão local já parou; o LiveKit recolhe a sala vazia sozinho.'
      )
      return false
    }

    await new Promise((resolve) => setTimeout(resolve, TEARDOWN_RETRY_MS))
  }
  return false
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
  start: (settings: TransmissionSettings, participantName: string) => Promise<boolean>
  // Item 13 do roadmap: troca resolução/FPS/fonte sem derrubar a sala —
  // reaproveita o whipUrl/streamKey do start() original (guardados em
  // ingressRef), nunca chama createIngress/getToken de novo.
  update: (settings: TransmissionSettings) => Promise<boolean>
  stop: () => Promise<void>
}

// onStartError: falha ao iniciar uma transmissão nova (TransmissionScreen) —
// pedido do usuário pra virar um snackbar em vez de texto fixo na tela.
// Só cobre start() de propósito: update() continua usando o `error` do
// próprio hook, consumido pelo UpdateTransmissionModal (esse mantém o
// texto inline, não foi pedido pra mudar).
export function useGstreamerTransmission(
  onStartError?: (message: string) => void
): UseGstreamerTransmissionResult {
  const [transmitting, setTransmitting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [settings, setSettings] = useState<TransmissionSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null)

  // Item 29 do roadmap — main empurra toda vez que o jogo/janela detectado
  // muda (ver gameDetection.ts); null tanto quando nada foi detectado
  // ainda quanto quando a transmissão parou.
  useEffect(() => window.api.games.onNowPlayingUpdate(setNowPlaying), [])

  // Guardado à parte do estado React — usado pelo update() pra saber
  // pra onde publicar sem precisar criar um ingress novo. Vive numa ref
  // (não state) porque nunca precisa disparar re-render sozinho.
  const ingressRef = useRef<{ whipUrl: string; streamKey: string } | null>(null)

  // Espelha `roomCode` numa ref — o handler de onExited (efeito com deps
  // vazias, registrado uma única vez) precisa do valor MAIS RECENTE no
  // momento em que o processo morre, não do valor capturado no fechamento
  // de quando o efeito montou (que ficaria sempre null).
  const roomCodeRef = useRef<string | null>(null)
  useEffect(() => {
    roomCodeRef.current = roomCode
  }, [roomCode])

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

      setTransmitting(false)
      setSettings(null)
      setNowPlaying(null)
      ingressRef.current = null

      if (wasExpected || !crashedRoomCode) {
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

  async function start(
    newSettings: TransmissionSettings,
    participantName: string
  ): Promise<boolean> {
    setError(null)
    const code = generateRoomCode()
    const { width, height } = RESOLUTION_DIMENSIONS[newSettings.resolution]
    const bitrateKbps = Math.round(
      VIDEO_MAX_BITRATE[newSettings.resolution][newSettings.fps] / 1000
    )

    try {
      const { url, streamKey } = await window.api.livekit.createIngress({
        roomName: code,
        participantName,
        private: newSettings.private
      })

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
        await window.api.livekit.deleteIngress(code)
        const message = result.error ?? 'Erro ao iniciar captura via GStreamer'
        setError(message)
        onStartError?.(message)
        return false
      }

      ingressRef.current = { whipUrl: url, streamKey }
      setSettings(newSettings)
      setRoomCode(code)
      setTransmitting(true)
      // Pedido do usuário (2026-09-06): confirmação sonora de que a live
      // subiu. Só aqui, depois de `result.ok` — se o GStreamer falhou ao
      // iniciar, a função já retornou lá em cima sem tocar nada.
      //
      // NÃO passa pela preferência `alertForNewLives`: ela desliga o
      // alerta de lives DOS OUTROS aparecendo na lista (decisão
      // confirmada com o usuário). Este som é resposta a um clique do
      // próprio usuário, não um alerta.
      playSound('newLive')
      return true
    } catch (err) {
      const message = getErrorMessage(err, 'Erro ao iniciar live via GStreamer')
      setError(message)
      onStartError?.(message)
      return false
    }
  }

  async function update(newSettings: TransmissionSettings): Promise<boolean> {
    if (!ingressRef.current || !roomCode) return false
    setError(null)
    const { width, height } = RESOLUTION_DIMENSIONS[newSettings.resolution]
    const bitrateKbps = Math.round(
      VIDEO_MAX_BITRATE[newSettings.resolution][newSettings.fps] / 1000
    )

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
        setError(result.error ?? 'Erro ao atualizar a transmissão')
        return false
      }

      setSettings(newSettings)
      return true
    } catch (err) {
      setError(getErrorMessage(err, 'Erro ao atualizar a transmissão'))
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
    setStopping(true)

    await window.api.gstreamer.stop()

    if (code) await teardownRoom(code)

    ingressRef.current = null
    setSettings(null)
    setRoomCode(null)
    setTransmitting(false)
    setStopping(false)
    setNowPlaying(null)
    // No fim de propósito: `stop()` fica em "Parando transmissão..."
    // enquanto insiste no teardown (pode levar segundos, ver o comentário
    // acima), então tocar aqui faz o som coincidir com a tela voltando ao
    // normal, e não com o clique.
    playSound('stopLive')
  }

  return { transmitting, stopping, roomCode, settings, error, nowPlaying, start, update, stop }
}
