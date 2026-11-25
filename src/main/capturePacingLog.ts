import { app, screen } from 'electron'
import { execFile } from 'child_process'
import { createWriteStream, existsSync, renameSync, statSync, WriteStream } from 'fs'
import { join } from 'path'

// LOG DO RITMO DA CAPTURA — TEMPORÁRIO (2026-11-24, pedido do usuário)
//
// Existe só pra investigar a live que "não fica suave" num monitor de
// 120 Hz com o jogo travado em 120 FPS e a transmissão a 60. Sai depois
// dos testes, junto com as três linhas que o ligam no gstreamerCapture.ts
// (procure por `capturePacing`).
//
// DE ONDE VÊM OS DADOS: o próprio `d3d11screencapturesrc`. Com a
// categoria dele em nível TRACE, o GStreamer escreve no stderr, a cada
// captura, duas coisas:
//
//   1. o despertar do timer — "Waiting for next frame time T" (no ritmo)
//      ou "No need to wait ... next frame = N prev = P" (ATRASADO: o
//      pipeline demorou e o elemento pulou N-P-1 vagas);
//   2. o que a Desktop Duplication devolveu — "Timeout" (nada mudou na
//      tela: o quadro anterior vai REPETIDO) ou "LastPresentTime: Q, ...
//      AccumulatedFrames: K" (K = quantos quadros a tela apresentou desde
//      a captura anterior; Q = o instante da última apresentação, em
//      ticks do QueryPerformanceCounter).
//
// O QUE RESPONDE À PERGUNTA: com o jogo a 120 e a captura a 60, uma
// captura regular vê SEMPRE 2 quadros novos, e o "passo" entre as
// apresentações de duas capturas seguidas é sempre 16,7 ms. Capturas
// alternando 1 e 3 (passos de 8 e 25 ms) é a imagem andando aos trancos
// mesmo com o contador marcando 60 certinho.
//
// Só a captura de TELA (DXGI) tem esses dados. A de janela usa outra API
// (WGC), que não informa nada disso: o log registra a live, mas sem as
// linhas por quadro.

export const CAPTURE_PACING_LOG_PATH = join(app.getPath('userData'), 'ritmo-captura.log')

// Passou disso, a próxima live começa um arquivo novo e o anterior vira
// `.old.log` — uma tarde de testes não pode encher o disco.
const TAMANHO_MAXIMO = 50 * 1024 * 1024

// Resumo a cada tantos segundos de live.
const RESUMO_A_CADA_S = 5

const CATEGORIA = 'd3d11screencapturesrc'

// O ambiente extra do gst-launch: só a categoria da captura em TRACE.
export function capturePacingEnv(): Record<string, string> {
  return { GST_DEBUG: `${CATEGORIA}:7`, GST_DEBUG_NO_COLOR: '1' }
}

// Frequência do QueryPerformanceCounter, pra converter o LastPresentTime
// em milissegundos. Pedida uma vez ao .NET; até chegar (ou se falhar)
// vale 10 MHz, que é o que o Windows 10/11 usa na prática.
let qpcFrequency = 10_000_000
let qpcFrequencyKnown = false
function queryQpcFrequency(): Promise<void> {
  if (qpcFrequencyKnown) return Promise.resolve()
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', '[System.Diagnostics.Stopwatch]::Frequency'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        const value = Number(String(stdout).trim())
        if (!err && Number.isFinite(value) && value > 0) {
          qpcFrequency = value
          qpcFrequencyKnown = true
        }
        resolve()
      }
    )
  })
}

export interface CapturePacingInfo {
  sourceId: string | null
  captureArgName: string
  captureArgValue: string
  width: number
  height: number
  fps: number
  bitrateKbps: number
}

// Estatística de uma janela de tempo (o resumo de 5 s, ou a live inteira).
class Janela {
  capturas = 0
  repetidas = 0
  atrasadas = 0
  vagasPuladas = 0
  soMouse = 0
  quadrosApresentados = 0
  // Quantas capturas viram 0, 1, 2, 3 e 4+ quadros novos.
  porQuantidade = [0, 0, 0, 0, 0]
  intervalos: number[] = []
  passos: number[] = []
  inicioS: number | null = null
  fimS = 0

  add(c: CapturaLida): void {
    if (this.inicioS === null) this.inicioS = c.t
    this.fimS = c.t
    this.capturas++
    if (c.atrasada) {
      this.atrasadas++
      this.vagasPuladas += c.vagasPuladas
    }
    if (c.quadros === 0) this.repetidas++
    if (c.soMouse) this.soMouse++
    this.quadrosApresentados += c.quadros
    this.porQuantidade[Math.min(c.quadros, 4)]++
    if (c.intervaloMs !== null) this.intervalos.push(c.intervaloMs)
    if (c.passoMs !== null) this.passos.push(c.passoMs)
  }

  texto(rotulo: string): string {
    const duracao = this.inicioS === null ? 0 : this.fimS - this.inicioS
    const pct = (n: number): string =>
      this.capturas ? `${((n * 100) / this.capturas).toFixed(1)}%` : '-'
    const dist = this.porQuantidade
      .map((n, i) => `${i === 4 ? '4+' : i}: ${n} (${pct(n)})`)
      .join(' | ')
    const linhas = [
      `---- ${rotulo} (${duracao.toFixed(1)} s) ----`,
      `capturas: ${this.capturas} = ${duracao > 0 ? (this.capturas / duracao).toFixed(2) : '-'} por segundo`,
      `a tela apresentou: ${this.quadrosApresentados} quadros = ${duracao > 0 ? (this.quadrosApresentados / duracao).toFixed(2) : '-'} por segundo`,
      `quadros novos por captura -> ${dist}`,
      `repetidas (nada novo na tela): ${this.repetidas} (${pct(this.repetidas)}) | só o mouse mudou: ${this.soMouse}`,
      `atrasadas (pipeline demorou): ${this.atrasadas} (${pct(this.atrasadas)}), vagas puladas: ${this.vagasPuladas}`,
      `intervalo entre capturas (ms): ${estat(this.intervalos)}`,
      `passo entre apresentações capturadas (ms): ${estat(this.passos)}`
    ]
    return linhas.join('\n') + '\n'
  }
}

function estat(valores: number[]): string {
  if (valores.length === 0) return 'sem dados'
  const media = valores.reduce((a, b) => a + b, 0) / valores.length
  const desvio = Math.sqrt(valores.reduce((a, v) => a + (v - media) ** 2, 0) / valores.length)
  const ord = [...valores].sort((a, b) => a - b)
  const p = (q: number): number => ord[Math.min(ord.length - 1, Math.floor(q * ord.length))]
  return (
    `média ${media.toFixed(2)} | desvio ${desvio.toFixed(2)} | ` +
    `mín ${ord[0].toFixed(2)} | p5 ${p(0.05).toFixed(2)} | p95 ${p(0.95).toFixed(2)} | ` +
    `máx ${ord[ord.length - 1].toFixed(2)}`
  )
}

interface CapturaLida {
  t: number // segundos, relógio do log do GStreamer
  atrasada: boolean
  vagasPuladas: number
  quadros: number
  soMouse: boolean
  intervaloMs: number | null
  passoMs: number | null
}

// Uma sessão = um processo do gst-launch (uma live, ou o trecho dela
// entre duas trocas de fonte).
export class CapturePacingSession {
  private out: WriteStream
  private resto = ''
  private pendente: { atrasada: boolean; vagasPuladas: number } | null = null
  private ultimaCapturaS: number | null = null
  private ultimaApresentacao: number | null = null
  private resumo = new Janela()
  private total = new Janela()
  private proximoResumoS: number | null = null
  private encerrada = false

  constructor(info: CapturePacingInfo) {
    try {
      if (existsSync(CAPTURE_PACING_LOG_PATH)) {
        if (statSync(CAPTURE_PACING_LOG_PATH).size > TAMANHO_MAXIMO) {
          renameSync(CAPTURE_PACING_LOG_PATH, CAPTURE_PACING_LOG_PATH.replace(/\.log$/, '.old.log'))
        }
      }
    } catch {
      // Sem rodízio: segue escrevendo no mesmo arquivo.
    }
    this.out = createWriteStream(CAPTURE_PACING_LOG_PATH, { flags: 'a' })
    this.out.on('error', () => undefined)
    this.escreverCabecalho(info)
    void queryQpcFrequency().then(() =>
      this.escrever(
        `frequência do QPC: ${qpcFrequency} Hz${qpcFrequencyKnown ? '' : ' (suposta — a consulta falhou)'}\n`
      )
    )
  }

  private escrever(texto: string): void {
    if (!this.encerrada) this.out.write(texto)
  }

  private escreverCabecalho(info: CapturePacingInfo): void {
    const telas = screen
      .getAllDisplays()
      .map((d) => {
        const w = Math.round(d.size.width * d.scaleFactor)
        const h = Math.round(d.size.height * d.scaleFactor)
        return (
          `  tela id ${d.id}${d.id === screen.getPrimaryDisplay().id ? ' (principal)' : ''}: ` +
          `${w}x${h} nativos, escala ${d.scaleFactor}, ${d.displayFrequency} Hz, ` +
          `posição ${d.bounds.x},${d.bounds.y}`
        )
      })
      .join('\n')
    const ehJanela = info.captureArgName === 'window-handle'
    this.escrever(
      [
        '',
        '==========================================================================',
        `LIVE INICIADA ${new Date().toISOString()} — Prisma ${app.getVersion()}`,
        `fonte: ${info.sourceId ?? '(padrão)'} -> ${info.captureArgName}=${info.captureArgValue}`,
        `pedido: ${info.width}x${info.height} a ${info.fps} FPS, ${info.bitrateKbps} kbps`,
        'telas:',
        telas,
        ehJanela
          ? 'ATENÇÃO: captura de JANELA (API WGC) — ela não informa os quadros da ' +
            'tela, então não haverá linhas por captura. Pro teste, transmita a TELA.'
          : 'captura de TELA (Desktop Duplication) — uma linha por captura abaixo.',
        '',
        'colunas: t(s) | desde a captura anterior (ms) | quadros novos na tela | ' +
          'passo desde a apresentação anterior capturada (ms) | observação',
        '  "quadros novos" = AccumulatedFrames: quantas vezes a tela foi atualizada',
        '  desde a captura anterior. Jogo a 120 com captura a 60, o regular é 2.',
        '  0 = nada mudou e o quadro anterior foi REPETIDO.',
        '  "passo" = distância entre as apresentações de duas capturas seguidas —',
        '  é o quanto a imagem "anda" de um quadro da live pro outro.',
        '==========================================================================',
        ''
      ].join('\n')
    )
  }

  // Recebe o stderr do gst-launch e devolve o que NÃO é deste log, pra
  // seguir pro gstreamer-debug.log como sempre.
  feed(chunk: string): string {
    const texto = this.resto + chunk
    const linhas = texto.split(/\r?\n/)
    this.resto = linhas.pop() ?? ''
    const outros: string[] = []
    for (const linha of linhas) {
      if (linha.includes(` ${CATEGORIA} `)) this.linhaDaCaptura(linha)
      else if (linha.trim()) outros.push(linha)
    }
    return outros.join('\n')
  }

  private linhaDaCaptura(linha: string): void {
    const cabeca = /^(\d+):(\d+):(\d+(?:\.\d+)?)\s+\S+\s+\S+\s+(\w+)\s/.exec(linha)
    const corpo = /\.cpp:\d+:\S+\s(.*)$/.exec(linha)
    if (!cabeca || !corpo) return
    const t = Number(cabeca[1]) * 3600 + Number(cabeca[2]) * 60 + Number(cabeca[3])
    const nivel = cabeca[4]
    const msg = corpo[1]

    if (msg.startsWith('Waiting for next frame time')) {
      this.pendente = { atrasada: false, vagasPuladas: 0 }
      return
    }
    const atraso = /^No need to wait .* next frame = (-?\d+) prev = (-?\d+)/.exec(msg)
    if (atraso) {
      const prox = Number(atraso[1])
      const ant = Number(atraso[2])
      // A primeira captura sempre cai aqui (prev = -1); não é atraso.
      const primeira = ant < 0
      this.pendente = {
        atrasada: !primeira,
        vagasPuladas: primeira ? 0 : Math.max(0, prox - ant - 1)
      }
      return
    }
    if (msg === 'Timeout') {
      this.fecharCaptura(t, 0, null)
      return
    }
    const quadro = /^LastPresentTime: (\d+),.*AccumulatedFrames: (\d+)/.exec(msg)
    if (quadro) {
      this.fecharCaptura(t, Number(quadro[2]), Number(quadro[1]))
      return
    }
    // O "timeout" do Capture() repete o do GetFrame — já contado.
    if (msg === 'timeout') return
    // O resto: só o que não é ruído por quadro (avisos, mudança de
    // tamanho, latência inicial).
    if (nivel !== 'TRACE' && nivel !== 'LOG') {
      this.escrever(`${t.toFixed(3)} [gst ${nivel}] ${msg}\n`)
    }
  }

  private fecharCaptura(t: number, quadros: number, apresentacao: number | null): void {
    const pend = this.pendente ?? { atrasada: false, vagasPuladas: 0 }
    this.pendente = null

    const intervaloMs = this.ultimaCapturaS === null ? null : (t - this.ultimaCapturaS) * 1000
    this.ultimaCapturaS = t

    // LastPresentTime = 0 com AccumulatedFrames > 0 não acontece; = 0
    // significa que só o ponteiro do mouse mudou.
    const soMouse = apresentacao === 0
    let passoMs: number | null = null
    if (apresentacao !== null && apresentacao > 0) {
      if (this.ultimaApresentacao !== null) {
        passoMs = ((apresentacao - this.ultimaApresentacao) * 1000) / qpcFrequency
      }
      this.ultimaApresentacao = apresentacao
    }

    const c: CapturaLida = {
      t,
      atrasada: pend.atrasada,
      vagasPuladas: pend.vagasPuladas,
      quadros,
      soMouse,
      intervaloMs,
      passoMs
    }

    const obs: string[] = []
    if (quadros === 0) obs.push('REPETIDO')
    if (soMouse) obs.push('só mouse')
    if (pend.atrasada) obs.push(`ATRASADA, ${pend.vagasPuladas} vaga(s) pulada(s)`)
    this.escrever(
      `${t.toFixed(4)} | ${intervaloMs === null ? '-' : intervaloMs.toFixed(2)} | ` +
        `${quadros} | ${passoMs === null ? '-' : passoMs.toFixed(2)}` +
        `${obs.length ? ' | ' + obs.join(', ') : ''}\n`
    )

    this.resumo.add(c)
    this.total.add(c)
    if (this.proximoResumoS === null) this.proximoResumoS = t + RESUMO_A_CADA_S
    if (t >= this.proximoResumoS) {
      this.escrever(this.resumo.texto(`resumo dos últimos ${RESUMO_A_CADA_S} s`))
      this.resumo = new Janela()
      this.proximoResumoS = t + RESUMO_A_CADA_S
    }
  }

  // O processo saiu (fim da live, troca de fonte ou queda).
  end(): void {
    if (this.encerrada) return
    if (this.resto) this.feed('\n')
    this.escrever(this.total.texto('RESUMO DA LIVE INTEIRA'))
    this.escrever(`LIVE ENCERRADA ${new Date().toISOString()}\n`)
    this.encerrada = true
    this.out.end()
  }
}
