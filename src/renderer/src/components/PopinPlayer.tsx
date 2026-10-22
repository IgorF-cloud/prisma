import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minimize2, Users, Volume2, VolumeX, X } from 'lucide-react'
import { useAutoHideOverlay } from '../lib/useAutoHideOverlay'

// Nome da janela — o main distingue o mini player de qualquer outro
// `window.open` por ele (ver POPIN_FRAME_PREFIX em src/main/popin.ts).
//
// ---------------------------------------------------------------------
// POR QUE UM SUFIXO ÚNICO A CADA ABERTURA
//
// BUG REAL (2026-09-20): o mini player não abria em desenvolvimento, e o
// clique não deixava rastro de erro nenhum. O log contou a história:
//
//   [renderer] componente montou, chamando window.open
//   [popin]    window.open interceptado: frameName="prisma-popin"
//   [popin]    janela criada (id 2)
//   [renderer] componente montou, chamando window.open   <- StrictMode
//   [renderer] window.open devolveu: janela
//
// Na segunda montagem não houve interceptação nem janela nova. É o
// comportamento padrão do `window.open(url, nome)`: com um nome que já
// existe, ele REAPROVEITA aquela janela e nem consulta o
// `setWindowOpenHandler`. E a janela daquele nome era a primeira, que a
// limpeza do <StrictMode> tinha acabado de mandar fechar — o conteúdo ia
// parar numa janela morta.
//
// Em produção o StrictMode não existe e a montagem é uma só, mas a
// corrida continuaria possível (fechar e reabrir o mini player rápido).
// Com um nome novo a cada abertura não há o que reaproveitar: toda
// abertura passa pelo main e cria a janela dela.
// ---------------------------------------------------------------------
const POPIN_FRAME_PREFIX = 'prisma-popin'
let proximaJanela = 0

interface PopinPlayerProps {
  hostName: string
  // Quem mais está assistindo ESTA live (mesmo filtro do tile).
  participants: string[]
  volume: number
  muted: boolean
  onSetVolume: (volume: number) => void
  onSetMuted: (muted: boolean) => void
  // Sair da SALA (o "x"): derruba a conexão e fecha a janelinha.
  onLeave: () => void
  // Voltar pra grade do app.
  onExpand: () => void
  // A janela morreu por fora (Alt+F4, sessão do Windows encerrando): a
  // live precisa voltar pra grade, mas sem trazer o app pra frente.
  onClosedExternally: () => void
  // Não deu pra abrir a janela. Separado do fechamento por fora porque o
  // desfecho é o mesmo (a live volta pra grade) mas a pessoa precisa
  // saber: senão o clique no botão simplesmente não faz nada.
  onFailed: () => void
  attachVideo: (element: HTMLVideoElement | null) => void
  // O <audio> da live (criado pelo livekit-client) precisa estar num
  // container montado, senão ele para de tocar — ver
  // getAttachAudioContainer em useViewer.ts. Ele fica na janela
  // PRINCIPAL de propósito, não na janelinha: som não tem lado visual, e
  // o documento da janelinha é um `about:blank` criado sem gesto do
  // usuário, terreno onde a política de autoplay do Chromium pode
  // atrapalhar sem necessidade nenhuma.
  attachAudioContainer: (element: HTMLDivElement | null) => void
}

// Copia o CSS do app pro documento da janelinha (2026-09-20).
//
// Ela nasce de um `window.open('')` — um `about:blank`, sem <head>
// nenhum. Como quem renderiza o conteúdo é o React DAQUI (por um
// portal), o HTML chega lá mas as regras de estilo não: elas pertencem
// ao outro documento.
//
// `link.href`/absoluto: em produção o CSS é um <link> com caminho
// relativo ao index.html, e um caminho relativo dentro de um
// `about:blank` não resolve contra nada. Ler a PROPRIEDADE `href` (e
// não o atributo) já devolve a URL absoluta, que é o que se copia. Em
// dev o Vite injeta <style> inline, coberto pelo mesmo seletor.
function copiarEstilos(alvo: Document): void {
  for (const node of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
    if (node instanceof HTMLLinkElement) {
      const copia = alvo.createElement('link')
      copia.rel = 'stylesheet'
      copia.href = node.href
      alvo.head.appendChild(copia)
    } else {
      alvo.head.appendChild(node.cloneNode(true))
    }
  }
}

// MINI PLAYER — a live fora da janela do app (2026-09-20, pedido do
// usuário).
//
// ---------------------------------------------------------------------
// POR QUE UM PORTAL, E NÃO UMA SEGUNDA APLICAÇÃO REACT
//
// A janelinha vive no MESMO processo do renderer (é o que permite a
// track de vídeo continuar tocando sem reconectar — ver popin.ts). Isso
// abre duas portas: montar outra raiz React no documento dela, ou
// estender ESTA árvore pra dentro dele com `createPortal`.
//
// O portal ganha porque o conteúdo depende inteiramente de estado que já
// vive aqui: volume, mudo, quem está assistindo, a própria track. Com
// uma segunda raiz, cada um desses viraria uma ponte manual, re-
// renderizada na mão a cada mudança. Com o portal, o mini player é só
// mais um componente lendo as mesmas props que o tile lia.
//
// (Verificado antes de escrever: cliques, `onChange` de slider e
// `onMouseMove` disparam normalmente num portal pra outra janela.)
// ---------------------------------------------------------------------
function PopinPlayer({
  hostName,
  participants,
  volume,
  muted,
  onSetVolume,
  onSetMuted,
  onLeave,
  onExpand,
  onClosedExternally,
  onFailed,
  attachVideo,
  attachAudioContainer
}: PopinPlayerProps): React.JSX.Element {
  // O ALVO DO PORTAL NASCE AQUI E SÓ DEPOIS VAI PRA JANELA.
  //
  // O caminho óbvio seria guardar o `document` da janelinha em estado e
  // renderizar o portal quando ele existisse. Isso custa um render a
  // mais só pra descobrir que a janela abriu — e é exatamente o
  // "setState dentro de efeito" que o React desencoraja.
  //
  // Com um <div> criado já no primeiro render, o portal tem alvo desde
  // sempre; o efeito só MOVE esse div pra dentro da janelinha
  // (`appendChild` adota o nó pro outro documento). Verificado que os
  // eventos do React continuam funcionando depois da mudança de
  // documento: clique, `onChange` de slider e `onMouseMove`.
  const [container] = useState(() => document.createElement('div'))

  // Em ref porque o efeito de abrir a janela roda UMA vez (reabrir a
  // cada render está fora de questão) e ainda assim precisa da versão
  // mais nova do callback no momento em que a janela fechar.
  const fechadaPorForaRef = useRef(onClosedExternally)
  const falhouRef = useRef(onFailed)
  useEffect(() => {
    fechadaPorForaRef.current = onClosedExternally
    falhouRef.current = onFailed
  })

  useEffect(() => {
    // URL vazia: o conteúdo vem do portal, não de um arquivo. O segundo
    // argumento é o que o main usa pra reconhecer a janela.
    const janela = window.open('', `${POPIN_FRAME_PREFIX}-${proximaJanela++}`)
    // Sem janela não há mini player — e, pior, o tile dessa live já saiu
    // da grade: ficar em silêncio deixaria uma live conectada, tocando o
    // áudio, sem aparecer em lugar nenhum. Desfaz na hora, que devolve o
    // tile.
    // `closed` já na abertura seria uma janela reaproveitada que estava
    // morrendo — não deve mais acontecer com o nome único, mas é barato
    // não confiar: o sintoma disso é o pior possível (o tile some da
    // grade e nada aparece no lugar).
    if (!janela || janela.closed) {
      // `null` aqui significa que o MAIN recusou a abertura — na prática,
      // que o `setWindowOpenHandler` dele não reconheceu o nome da janela
      // (ver popinOpenHandler em src/main/popin.ts). O caso clássico é um
      // `npm run dev` que ficou com a versão antiga do processo main na
      // memória: o renderer já tem o mini player, o main ainda não, e o
      // clique não faz nada visível. Deixar explícito no console poupa a
      // próxima meia hora de investigação.
      console.error(
        '[popin] o processo main recusou abrir a janela do mini player. ' +
          'Em desenvolvimento, reinicie o `npm run dev` (o main precisa ser ' +
          'recompilado); em produção, verifique o setWindowOpenHandler em src/main/index.ts.'
      )
      falhouRef.current()
      return
    }

    janela.document.body.className = 'popin-body'
    copiarEstilos(janela.document)
    janela.document.body.appendChild(container)

    // Fechada por fora (Alt+F4, logoff): devolve a live pra grade. O
    // nosso próprio `close()` na limpeza abaixo também passa por aqui, e
    // é inofensivo — quem recebe isto já está desfazendo o mini player.
    const aoFechar = (): void => fechadaPorForaRef.current()
    janela.addEventListener('beforeunload', aoFechar)

    // Rede de segurança pro "mostrar quando tiver imagem" (ver o <video>
    // abaixo e popin.ts): se o primeiro quadro demorar — host travado,
    // rede ruim —, a janela não pode ficar invisível pra sempre. Meio
    // segundo é mais que o suficiente pra uma track que já estava
    // tocando no tile; passou disso, mostra do jeito que estiver.
    const mostrarDeQualquerJeito = setTimeout(() => window.api.popin.ready(), 500)

    return () => {
      clearTimeout(mostrarDeQualquerJeito)
      janela.removeEventListener('beforeunload', aoFechar)
      janela.close()
    }
  }, [container])

  const overlay = useAutoHideOverlay()

  // Estado do arrasto (2026-09-20, 2a rodada). Em ref e não em state: isto
  // muda a cada movimento do mouse e nada na tela depende dele — um
  // `setState` aqui seria uma re-renderização por quadro, durante um
  // arrasto, na janela que está tocando vídeo.
  const arrastoRef = useRef<{
    pointerId: number
    // A janelinha, guardada porque é o `requestAnimationFrame` DELA que
    // marca o compasso (ver onPointerDown).
    janela: Window
    x: number
    y: number
    // Envio já agendado pro próximo quadro, ou null.
    quadro: number | null
  } | null>(null)

  const terminarArrasto = useCallback(() => {
    const arrasto = arrastoRef.current
    // Sai calado quando não há arrasto: os três eventos que chamam isto
    // podem chegar em sequência pro mesmo arrasto.
    if (!arrasto) return
    arrastoRef.current = null
    if (arrasto.quadro !== null) arrasto.janela.cancelAnimationFrame(arrasto.quadro)
    window.api.popin.dragEnd()
  }, [])

  return (
    <>
      <div ref={attachAudioContainer} hidden />
      {createPortal(
        <div
          className={`popin${overlay.visible ? ' popin-hovered' : ''}`}
          onMouseMove={overlay.onMouseMove}
          onMouseLeave={overlay.onMouseLeave}
          // ARRASTAR A JANELA (2026-09-20).
          //
          // Sem `-webkit-app-region: drag` de propósito: aquela região faz o
          // Windows tratar a área como barra de título, e barra de título
          // não entrega eventos de mouse pra página — o hover que mostra os
          // chips e escurece a janela morreria justamente onde a pessoa
          // passa o mouse.
          //
          // Quem dita o ritmo é esta ponta (2026-09-20, 2a rodada): os
          // eventos de ponteiro são o fluxo de entrada do sistema, sem
          // relógio nenhum no meio. O main só aplica a posição — ver
          // popin.ts pro timer de 16ms que vivia lá e era a causa do
          // arrasto travado.
          onPointerDown={(event) => {
            // Botão esquerdo, e nunca a partir de um controle: arrastar pelo
            // slider de volume seria impossível de usar.
            if (event.button !== 0) return
            if ((event.target as HTMLElement).closest('.tile-control')) return
            // O `requestAnimationFrame` tem que ser o DA JANELINHA, não o
            // desta janela: com o app minimizado (caso normal do mini
            // player) o rAF da janela principal é estrangulado ou
            // suspenso, e o arrasto congelaria junto.
            const janela = container.ownerDocument.defaultView
            if (!janela) return
            // Captura do ponteiro: o cursor sai da janelinha o tempo todo
            // durante um arrasto (ela é pequena e anda junto), e sem isso
            // os eventos parariam de chegar no meio do caminho.
            event.currentTarget.setPointerCapture(event.pointerId)
            arrastoRef.current = {
              pointerId: event.pointerId,
              janela,
              x: event.screenX,
              y: event.screenY,
              quadro: null
            }
            window.api.popin.dragStart(event.screenX, event.screenY)
          }}
          onPointerMove={(event) => {
            const arrasto = arrastoRef.current
            if (!arrasto || event.pointerId !== arrasto.pointerId) return
            // Guarda a posição e agenda UM envio pro próximo quadro. O
            // mouse reporta muito mais rápido que a tela desenha; mandar
            // tudo seria trabalho que ninguém chega a ver.
            arrasto.x = event.screenX
            arrasto.y = event.screenY
            if (arrasto.quadro !== null) return
            arrasto.quadro = arrasto.janela.requestAnimationFrame(() => {
              arrasto.quadro = null
              if (arrastoRef.current !== arrasto) return
              window.api.popin.dragMove(arrasto.x, arrasto.y)
            })
          }}
          onPointerUp={terminarArrasto}
          onPointerCancel={terminarArrasto}
          // Rede de segurança: a captura se perde sozinha se a janelinha
          // for fechada ou perder o foco no meio do arrasto, e aí o
          // `pointerup` nunca chega.
          onLostPointerCapture={terminarArrasto}
        >
          {/* `onLoadedData` é o gatilho de "pode aparecer": a janela nasce
              escondida pra não piscar preto antes do vídeo (ver popin.ts).
              Este é o mesmo evento que o tile usa pra saber que a live
              tem conteúdo de verdade. */}
          <video
            ref={attachVideo}
            className="popin-video"
            autoPlay
            playsInline
            onLoadedData={() => window.api.popin.ready()}
          />

          {/* O escurecido do hover (pedido do usuário) — some junto com os
          chips, então é o mesmo estado. */}
          <div className="popin-dim" />

          {/* Os mesmos chips do tile (`.tile-chip`, 2026-10-22), só que
              menores — o `.popin` encolhe as variáveis deles no CSS. */}
          <div className="popin-top-left">
            <div className="tile-chip tile-control">
              <button
                type="button"
                className="tile-chip-button"
                onClick={onExpand}
                aria-label="Voltar pro app"
              >
                <Minimize2 size={13} />
              </button>
            </div>
            <span className="tile-chip tile-chip-label tile-control">
              <span className="tile-chip-live-dot" />
              <span className="popin-host-name">{hostName}</span>
            </span>
          </div>

          <div className="popin-top-right">
            <div className="tile-chip tile-control">
              <span className="tile-chip-stat">
                <Users size={12} />
                {participants.length}
              </span>
              <button
                type="button"
                className="tile-chip-button tile-chip-button-danger"
                onClick={onLeave}
                aria-label="Sair da live"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="popin-volume tile-chip tile-chip-volume tile-control">
            <button
              type="button"
              className="tile-chip-button"
              onClick={() => onSetMuted(!muted)}
              aria-label={muted ? 'Ativar som' : 'Mutar'}
            >
              {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <input
              type="range"
              className="volume-slider"
              min={0}
              max={100}
              value={Math.round((muted ? 0 : volume) * 100)}
              onChange={(e) => onSetVolume(Number(e.target.value) / 100)}
              style={{
                background: `linear-gradient(to right, #a78bfa ${(muted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.18) ${(muted ? 0 : volume) * 100}%)`
              }}
              aria-label="Volume"
            />
          </div>
        </div>,
        container
      )}
    </>
  )
}

export default PopinPlayer
