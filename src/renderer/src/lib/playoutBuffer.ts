import type { RemoteTrack } from 'livekit-client'

// O BUFFER DE SUAVIZAÇÃO DE QUEM ASSISTE (2026-11-24, pedido do usuário)
//
// Sem isto o WebRTC trabalha no modo de menor atraso possível: cada
// quadro é mostrado assim que chega e decodifica. Quadros que saem do
// host em ritmo certinho (de 16,7 em 16,7 ms a 60 FPS) chegam com a
// variação da rede — um em 10 ms, o seguinte em 25 — e essa variação vai
// direto pra tela como tremida.
//
// Com um alvo de buffer o navegador segura cada quadro um pouco e o
// mostra no instante marcado pelo carimbo de tempo do host, então a
// variação da rede some e o movimento volta a ter o ritmo da captura.
//
// 80 ms porque o usuário pediu entre 50 e 100, "pra ainda parecer
// instantâneo". É um PISO, não um teto: numa rede ruim o navegador já
// aumentava o buffer por conta própria antes disto, e continua
// aumentando. O áudio da mesma live acompanha sozinho (o navegador
// sincroniza o som com o vídeo do mesmo participante), então a voz não
// sai adiantada da imagem.
export const PLAYOUT_BUFFER_MS = 80

// `jitterBufferTarget` é o nome padrão (em milissegundos, Chrome 114+). O
// `setPlayoutDelay` do LiveKit usa o nome antigo do Chrome
// (`playoutDelayHint`, em segundos) e fica de degrau de baixo.
export function applyPlayoutBuffer(track: RemoteTrack): void {
  const receiver = track.receiver as (RTCRtpReceiver & { jitterBufferTarget?: number }) | undefined
  if (!receiver) return
  try {
    if ('jitterBufferTarget' in receiver) {
      receiver.jitterBufferTarget = PLAYOUT_BUFFER_MS
    } else {
      track.setPlayoutDelay(PLAYOUT_BUFFER_MS / 1000)
    }
  } catch {
    // Navegador que recusa o valor: fica no modo de antes, sem buffer.
  }
}
