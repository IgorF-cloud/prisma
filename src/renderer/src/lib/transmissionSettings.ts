// Tipos/constantes de configuração de transmissão — extraído de
// useTransmission.ts em 2026-08-30, quando o caminho de captura via
// Chromium (getDisplayMedia) foi removido (substituído pelo GStreamer,
// ver useGstreamerTransmission.ts). Continua compartilhado entre a
// TransmissionScreen.tsx, o UpdateTransmissionModal.tsx (mantido pronto
// pra quando o item 13 do roadmap for reimplementado pro GStreamer) e o
// useGstreamerTransmission.ts.
export type Resolution = '720p' | '1080p' | '1440p' | '4k'
export type Fps = 30 | 60

export const RESOLUTIONS: Resolution[] = ['720p', '1080p', '1440p', '4k']
export const FPS_OPTIONS: Fps[] = [30, 60]

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
export const VIDEO_MAX_BITRATE: Record<Resolution, Record<Fps, number>> = {
  '720p': { 30: 4_000_000, 60: 6_000_000 },
  '1080p': { 30: 6_000_000, 60: 9_000_000 },
  '1440p': { 30: 10_000_000, 60: 15_000_000 },
  '4k': { 30: 20_000_000, 60: 30_000_000 }
}

// O TETO de pico correspondente (`max-bitrate` do encoder) é
// derivado destes valores no main, em src/main/gstreamerCapture.ts —
// é assunto do encoder, não da tela de configuração.
