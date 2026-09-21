import { API_BASE_URL } from './config'
import { authHeader } from './apiToken'
import { logGstreamer } from './gstreamerLog'

// "Vou reiniciar o pipeline, segura a sala" (2026-09-20).
//
// ---------------------------------------------------------------------
// O BUG QUE ISTO CONSERTA
//
// Teste real do usuário: transmitindo o CLIENTE do LoL, a partida
// começou (o seguidor trocou pra janela do jogo sozinho, ver
// gameWindowFollow.ts) e no FIM da partida a live "parou e voltou
// sozinha no cliente", expulsando quem estava assistindo.
//
// A troca em si funcionou. Quem derrubou a sala foi o servidor: quando o
// publisher do ingress sai, ele dá 3 segundos pra alguém voltar a
// publicar antes de apagar a sala (item 46 — não deixar viewer preso
// numa live sem dono). O problema é que TODA troca de fonte passa por
// aí, porque o GStreamer não reconfigura um pipeline em andamento: o
// processo morre e outro sobe no lugar. E esse intervalo passa dos 3s
// com facilidade — enumerar janelas custa 450-800ms, o gst-launch leva
// mais um tanto pra subir e a negociação WHIP também não é instantânea.
//
// Aumentar os 3s pra todo mundo seria pagar o conserto com o caso que a
// regra existe pra proteger: quem cai DE VERDADE deve derrubar a sala
// rápido. A diferença entre "caiu" e "estou voltando" só existe aqui
// dentro, onde a reconexão é uma decisão nossa — então ela é dita em voz
// alta, e o servidor estende a folga só pra sala avisada
// (HOSTLESS_RECONNECT_GRACE_MS em server.js).
// ---------------------------------------------------------------------
//
// Dispara e esquece, de propósito. Isto roda em dois caminhos críticos —
// a troca de fonte e a morte do processo — e nenhum dos dois pode ficar
// esperando uma resposta HTTP pra seguir: cada milissegundo aqui é
// milissegundo de live parada, que é exatamente o que se está tentando
// encurtar. Se o aviso não chegar, o pior que acontece é o
// comportamento de antes (a sala cai em 3s), nunca algo pior.
export function notifyRoomReconnecting(roomCode: string): void {
  fetch(`${API_BASE_URL}/rooms/${roomCode}/reconnecting`, {
    method: 'POST',
    headers: { Authorization: authHeader() }
  })
    .then((response) => {
      if (!response.ok) {
        logGstreamer(
          `aviso de reconexão da sala ${roomCode} recusado pelo servidor ` +
            `(HTTP ${response.status}) — a sala segue com a folga curta`
        )
      }
    })
    .catch((err) => logGstreamer(`falha ao avisar reconexão da sala ${roomCode}: ${err}`))
}
