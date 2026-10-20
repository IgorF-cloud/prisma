import type { CaptureSource } from '../components/CaptureSourceCard'

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

// O que vai junto da criação da sala (2026-10-16, "start instantâneo"):
// o que a grade de fontes já sabe, sem esperar detecção de jogo nenhuma.
// A janela leva o título e o ícone do programa; o monitor, o nome da
// tela. O jogo, quando houver, chega depois pelo polling do main
// (gameDetection.ts) e troca isto no tile de todo mundo.
//
// O teto do ícone existe porque o servidor recusa o POST /ingress INTEIRO
// (413) com um `iconUrl` acima de 64 KB — um ícone grande demais não pode
// custar a live. Os ícones do Windows ficam em 3-6 KB; sem ele, a sala
// nasce só com o nome e o placeholder.
const INITIAL_ICON_MAX_CHARS = 60 * 1024

export function nowPlayingFromSource(source: CaptureSource): NowPlayingInfo {
  if (source.type === 'screen') return { kind: 'screen', name: source.name, iconUrl: null }
  const icon = source.iconDataUrl
  return {
    kind: 'window',
    name: source.name,
    iconUrl: icon && icon.length <= INITIAL_ICON_MAX_CHARS ? icon : null
  }
}
