import { useState, type JSX } from 'react'
import { NowPlayingInfo } from '../lib/nowPlaying'
import gamePlaceholder from '../assets/steam.png'
import screenPlaceholder from '../assets/monitor.png'
import windowPlaceholder from '../assets/window.png'

// Pedido do usuário (2026-09-05): quadrado no leading do tile da live
// (footer da Home) com a arte do que está sendo transmitido — a capa do
// jogo quando a lista do Discord tem ícone pra ele, um desenho de
// placeholder em qualquer outro caso.
//
// Qual placeholder depende do `kind` (ver gameDetectableCache.ts/
// gameDetection.ts no main):
//   game   -> Steam     (jogo reconhecido, mas o app não tem ícone na
//                        lista — ~17% deles — ou a imagem não carregou)
//   screen -> monitor   (monitor inteiro, nenhum jogo detectado)
//   window -> janela    (janela específica que não bateu com a lista)
//
// Os três eram ícones do lucide sobre um quadrado roxo até 2026-09-14,
// quando o usuário desenhou os PNGs e pediu pra tirar o fundo: agora é
// só o desenho branco, centrado, sobre o fundo do tile.
const PLACEHOLDER_IMAGE: Record<NowPlayingInfo['kind'], string> = {
  game: gamePlaceholder,
  screen: screenPlaceholder,
  window: windowPlaceholder
}

export default function NowPlayingArt({ info }: { info: NowPlayingInfo }): JSX.Element {
  // Guarda a URL que FALHOU, não um booleano "falhou": a imagem vem do
  // CDN do Discord e pode não carregar (rede, ou hash velho — a lista
  // local vale até 3 dias, ver gameDetectableCache.ts), e sem isso o
  // quadrado ficaria vazio em vez de cair no placeholder.
  //
  // Comparar a URL guardada com a atual já dá o "reset ao trocar de
  // jogo" de graça: o polling do monitor troca o `nowPlaying` sem
  // desmontar este componente, e com um booleano a falha de um jogo
  // grudaria e esconderia a arte do jogo seguinte.
  //
  // Desde 2026-09-14 isto também cobre o ícone da JANELA transmitida,
  // que chega como `data:image/png;base64,...` (ver windowIcon.ts no
  // main). Um data URL não falha por rede, mas o caminho é o mesmo.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const iconUrl = info.iconUrl ?? null
  const showArt = Boolean(iconUrl) && iconUrl !== failedUrl

  return (
    <div className="live-tile-art">
      {showArt ? (
        <img src={iconUrl as string} alt="" onError={() => setFailedUrl(iconUrl)} />
      ) : (
        // `-placeholder` na IMAGEM e não no container: o desenho é branco
        // com transparência em volta, então ele precisa de uma folga
        // interna pra não encostar nas bordas do quadrado — e a arte de
        // verdade, que preenche o quadrado inteiro, não pode herdar essa
        // folga.
        <img
          className="live-tile-art-placeholder"
          src={PLACEHOLDER_IMAGE[info.kind] ?? gamePlaceholder}
          alt=""
        />
      )}
    </div>
  )
}
