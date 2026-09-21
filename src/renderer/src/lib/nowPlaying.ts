// Item 29 do roadmap: o que está sendo transmitido agora — jogo detectado
// (lista do Discord), janela específica ou monitor inteiro.
//
// Esse tipo vinha DUPLICADO em quatro lugares (useGstreamerTransmission,
// useRooms, HomeScreen e o preload) e eles saíram de sincronia na hora de
// adicionar `'screen'`/`iconUrl` (2026-09-05). Agora os três do renderer
// importam daqui; o preload mantém a própria cópia de propósito, porque
// `index.d.ts` descreve a fronteira de IPC e não pode importar de dentro
// do renderer.
export interface NowPlayingInfo {
  // 'game' é o único que muda o rótulo ("Jogando:" em vez de
  // "Transmitindo:"). 'screen' e 'window' se diferenciam só pelo ícone do
  // placeholder quando não há arte — monitor x janela.
  kind: 'game' | 'window' | 'screen'
  name: string
  // Arte do jogo no CDN do Discord. null/ausente pra janela, monitor, e
  // pro jogo cujo app não tem ícone na lista (~17% deles).
  iconUrl?: string | null
}
