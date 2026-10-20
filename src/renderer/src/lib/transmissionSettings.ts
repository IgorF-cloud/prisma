// Tipos/constantes de configuração de transmissão — extraído de
// useTransmission.ts em 2026-08-30, quando o caminho de captura via
// Chromium (getDisplayMedia) foi removido (substituído pelo GStreamer,
// ver useGstreamerTransmission.ts). Continua compartilhado entre a
// TransmissionScreen.tsx, o UpdateTransmissionModal.tsx (mantido pronto
// pra quando o item 13 do roadmap for reimplementado pro GStreamer) e o
// useGstreamerTransmission.ts.
export type Resolution = '720p' | '1080p' | '1440p' | '4k'
// Era `30 | 60` até 2026-10-09. Virou número aberto porque o FPS
// oferecido passou a depender da TAXA DO MONITOR — ver `fpsOptionsFor`
// logo abaixo, que num monitor de 144 Hz devolve 24 e 48 em vez de
// 30 e 60.
export type Fps = number

export const RESOLUTIONS: Resolution[] = ['720p', '1080p', '1440p', '4k']

// Os dois degraus que a tela sempre oferece — um econômico e um fluido.
// São também o que vale quando não dá pra saber a taxa do monitor.
export const FPS_OPTIONS: Fps[] = [30, 60]

// Piso de qualquer opção calculada. Abaixo disso o ganho de suavidade
// de casar com o monitor não compensa o quanto a imagem fica picotada:
// 24 é o padrão de cinema e é o menos que vale a pena transmitir.
const MIN_FPS = 24

// O maior FPS que (a) divide `refreshHz` em número INTEIRO, (b) não passa
// de `limite` e (c) não desce abaixo de MIN_FPS. `null` se não existe
// nenhum.
//
// A busca começa no menor divisor possível (`ceil`) e vai descendo o
// FPS a cada passo, então o primeiro acerto já é o maior.
function largestExactDivisor(refreshHz: number, limite: number): number | null {
  for (let k = Math.ceil(refreshHz / limite); refreshHz / k >= MIN_FPS; k++) {
    if (Number.isInteger(refreshHz / k)) return refreshHz / k
  }
  return null
}

// As opções de FPS pra um monitor de `refreshHz` Hz.
//
// ⚠️ SEM USO DESDE 2026-10-17 (rollback): o dialog de fontes voltou a
// oferecer só FPS_OPTIONS, na investigação de lives congelando a cada
// segundo na 1.4.0 (um dos usuários transmitia a 48 FPS num monitor de
// 144 Hz). Fica aqui pra ser religado com teste de verdade — ver o
// comentário em SourcePickerDialog.tsx pro defeito que o religamento
// precisa evitar (48 virando 60 no clique).
//
// POR QUE NÃO É SEMPRE 30 E 60 (2026-10-09, defeito relatado pelo
// usuário: live "não tão suave" num monitor de alta taxa): a captura só
// recebe quadro novo quando o monitor apresenta um. Pedir 60 num monitor
// de 144 Hz pede uma amostra a cada 2,4 quadros — como não existe 0,4 de
// quadro, o capturador alterna entre pegar 2 e 3 quadros de MOVIMENTO e
// carimbar os dois com o mesmo intervalo de 16,7ms. Nada é descartado, o
// contador diz 60fps, e mesmo assim a imagem treme num ritmo regular.
// Com 48 (144/3) cada amostra cobre exatamente 3 quadros, sempre, e o
// movimento sai liso.
//
// Cada degrau de FPS_OPTIONS vira o maior divisor exato que não passa
// dele. Num monitor de 120 Hz isso devolve os mesmos 30 e 60 de sempre
// (120/4 e 120/2 são exatos), então a grande maioria não vê diferença
// nenhuma — é justamente quem tem 144/165 Hz que ganha opção nova.
//
// Sem divisor exato pra um degrau, o degrau fica com o valor nominal
// mesmo: é melhor oferecer 60 com tremida do que esconder a opção.
export function fpsOptionsFor(refreshHz: number | null | undefined): Fps[] {
  const hz = Math.round(refreshHz ?? 0)
  if (!Number.isFinite(hz) || hz < MIN_FPS) return FPS_OPTIONS

  const options: Fps[] = []
  for (const nominal of FPS_OPTIONS) {
    const value = largestExactDivisor(hz, nominal) ?? nominal
    if (!options.includes(value)) options.push(value)
  }

  // Os dois degraus podem cair no MESMO divisor (75 Hz: tanto o de 30
  // quanto o de 60 dão 25). Uma pílula só seria uma tela sem escolha —
  // então o degrau nominal que faltou entra como segunda opção, mesmo
  // não sendo exata.
  for (const nominal of FPS_OPTIONS) {
    if (options.length >= FPS_OPTIONS.length) break
    if (!options.includes(nominal)) options.push(nominal)
  }

  return options.sort((a, b) => a - b)
}

// Esse FPS casa certinho com a taxa do monitor? É o que decide se a tela
// mostra o aviso de que a imagem pode tremer.
export function isExactForRefresh(fps: Fps, refreshHz: number | null | undefined): boolean {
  const hz = Math.round(refreshHz ?? 0)
  if (!Number.isFinite(hz) || hz <= 0) return true
  return Number.isInteger(hz / fps)
}

// A opção mais próxima de `fps` dentro de `options`. Usada quando trocar
// de fonte troca as opções e o valor marcado deixa de existir (estava em
// 60 num monitor de 120 Hz, mudou pra um de 144 Hz onde as opções são 24
// e 48): em vez de pular pro padrão, fica no degrau equivalente.
export function nearestFps(options: Fps[], fps: Fps): Fps {
  return options.reduce((melhor, option) =>
    Math.abs(option - fps) < Math.abs(melhor - fps) ? option : melhor
  )
}

// Um FPS gravado por uma versão ANTERIOR do app (ou por outro monitor)
// ainda é utilizável? Faixa, e não lista: a lista depende do monitor que
// estiver ligado agora, e um 48 gravado num monitor de 144 Hz continua
// perfeitamente válido.
export function isValidFps(value: unknown): value is Fps {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_FPS && value <= 60
}

export interface TransmissionSettings {
  resolution: Resolution
  fps: Fps
  // id de uma fonte do desktopCapturer (ex: "screen:0:0", "window:1234:0")
  // — resolvido pro HMONITOR/HWND real do Windows em
  // src/main/nativeCaptureTargets.ts na hora de montar o pipeline do
  // GStreamer.
  sourceId: string | null
  // Checkbox "Transmissão privada" (2026-09-10, substituiu a senha de
  // sala). Privada = não aparece na lista de ninguém; só entra quem o
  // host convidar.
  //
  // Só vale na hora de CRIAR a sala (createIngress, ver
  // useGstreamerTransmission.ts `start()`) — trocar resolução/FPS/fonte
  // via `update()` não recria a sala, então isso não muda depois que a
  // live está no ar.
  private: boolean
}

export const RESOLUTION_DIMENSIONS: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 }
}

// Bitrate máximo (bps) por resolução/FPS — valores pesquisados (YouTube/
// Twitch/OBS recomendam algo entre 4-12 Mbps pra esse tipo de conteúdo) e
// revisados com o usuário em 2026-08-29: os primeiros valores (até 45 Mbps
// em 4k) eram agressivos demais pro encoder de hardware de máquinas mais
// fracas dar conta em tempo real (e o app não é só LAN — deve rodar numa
// VM/internet também, então nada de valor "sem limite pensando em banda
// infinita").
// Subido em 2026-09-11 (pedido do usuário: a qualidade estava baixa).
// A folga só ficou segura porque o encoder ganhou um TETO no mesmo
// commit — ver `rc-mode=pcvbr` em gstreamerCapture.ts. Até então o
// modo era `uvbr` (variável SEM restrição), e esses números eram uma
// sugestão que o encoder estourava à vontade numa cena movimentada.
//
// ⚠️ Estes NÃO são números de gravação local. Tabelas de "bitrate
// ideal" na internet quase sempre falam de arquivo em disco, onde 30
// Mbps pra 1080p60 é razoável. Atravessando a internet até vários
// espectadores é outra conta: a Twitch limita em ~6-8 Mbps e o
// YouTube recomenda 9-12 pra 1080p60. O que manda aqui é o que a
// SUBIDA do host e a saída da VM sustentam — subir isso não melhora
// nada se o link não acompanhar, só troca imagem borrada por imagem
// travada.
// ⚠️ REVERTIDO em 2026-09-17 para os valores de antes de 2026-09-11.
//
// O aumento foi feito pra melhorar a qualidade, e melhorou — mas veio
// junto um sintoma NOVO que o usuário descreveu bem: a cada 2-3 minutos
// a live congela por 2-3 segundos e volta a ficar lisa. O padrão é
// REGULAR, quase relojoeiro, e é isso que o distingue do problema
// antigo (travadas irregulares, de instabilidade de upload).
//
// A explicação que o arranjo daqui permite: o caminho até o espectador
// NÃO TEM CONTROLE DE CONGESTIONAMENTO. O GStreamer publica por WHIP num
// bitrate fixo e não recebe retorno nenhum do que a rede aguenta — ao
// contrário de uma chamada WebRTC comum, em que o emissor baixa a taxa
// sozinho quando a banda aperta. Se a média pedida fica um pouco acima
// do que o enlace sustenta, a fila cresce devagar até estourar: trava,
// esvazia, volta ao normal — e recomeça. O período depende de quão
// pequena é a folga, o que explica ser tão constante.
//
// Estes números continuam acima do que a Twitch aceita (~6-8 Mbps em
// 1080p60) e dentro do que o YouTube recomenda (9-12). Ver o comentário
// grande acima sobre por que tabela de "bitrate ideal" da internet não
// serve aqui.
//
// Os dois valores por resolução são ÂNCORAS, não a lista de FPS
// possíveis (desde 2026-10-09 o FPS depende do monitor, ver
// `fpsOptionsFor`). Quem traduz um FPS qualquer em bitrate é
// `videoMaxBitrate` logo abaixo.
export const VIDEO_MAX_BITRATE: Record<Resolution, Record<30 | 60, number>> = {
  '720p': { 30: 4_000_000, 60: 6_000_000 },
  '1080p': { 30: 6_000_000, 60: 9_000_000 },
  '1440p': { 30: 10_000_000, 60: 15_000_000 },
  '4k': { 30: 20_000_000, 60: 30_000_000 }
}

// O bitrate alvo (bps) de uma combinação resolução + FPS.
//
// Interpola em linha reta entre as duas âncoras da tabela acima (2026-10-09,
// quando o FPS deixou de ser só 30 ou 60). Reta e não curva porque é
// assim que o custo de um encoder se comporta na faixa estreita que
// interessa aqui — entre 24 e 60 quadros, com a mesma cena e a mesma
// resolução, o dobro de quadros custa perto do dobro de bits, e os dois
// números pesquisados já carregam o desconto da redundância entre
// quadros vizinhos.
//
// Em 30 e 60 devolve exatamente os valores da tabela: ninguém que já
// transmitia muda de bitrate por causa disso.
export function videoMaxBitrate(resolution: Resolution, fps: Fps): number {
  const ancoras = VIDEO_MAX_BITRATE[resolution]
  // Prende na faixa das âncoras antes de interpolar — assim um FPS
  // inesperado nunca vira um bitrate absurdo (negativo, ou o dobro do
  // teto pesquisado), por mais que `fpsOptionsFor` já não produza nenhum.
  const quadros = Math.min(60, Math.max(MIN_FPS, fps))
  const inclinacao = (ancoras[60] - ancoras[30]) / (60 - 30)
  return Math.round(ancoras[30] + inclinacao * (quadros - 30))
}

// O TETO de pico correspondente (`max-bitrate` do encoder) é
// derivado destes valores no main, em src/main/gstreamerCapture.ts —
// é assunto do encoder, não da tela de configuração.
