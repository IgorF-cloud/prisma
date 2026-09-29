import { Check, LayoutGrid } from 'lucide-react'
import Tooltip from './Tooltip'
import screenIcon from '../assets/monitor.png'

export interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnailDataUrl: string
  // Só vem preenchido pra fontes de JANELA, e mesmo assim pode ser null
  // (processo protegido, título que não casou com a enumeração do
  // PowerShell) — ver screenCapture.ts no main.
  appName: string | null
  iconDataUrl: string | null
}

interface CaptureSourceCardProps {
  source: CaptureSource
  selected: boolean
  onSelect: () => void
}

// O desenho de monitor do app (o mesmo do tile da live no rodapé da
// Home, ver NowPlayingArt.tsx) — 2026-09-24, pedido do usuário. Fonte
// de TELA não tem programa dono nem ícone pra pedir ao Windows, então
// o lugar do ícone ficaria vazio só nela.
function iconFor(source: CaptureSource): string | null {
  return source.type === 'screen' ? screenIcon : source.iconDataUrl
}

// Um card da grade de seleção de fonte (2026-09-24). Nasceu duplicado
// entre a TransmissionScreen e o UpdateTransmissionModal — as duas
// desenhavam a mesma coisa, e a segunda está desligada esperando o item
// 13 do roadmap, então a cópia ia ficar pra trás calada. Aqui as duas
// mudam juntas.

function CaptureSourceCard({
  source,
  selected,
  onSelect
}: CaptureSourceCardProps): React.JSX.Element {
  const icon = iconFor(source)

  // Sem `title=` no botão de propósito (2026-09-24, pedido do usuário):
  // o tooltip nativo do Windows aparecia sozinho por cima do nosso, com
  // atraso e visual próprios. O Tooltip do app é o único agora.
  //
  // `top` porque a grade rola dentro de um container estreito — um balão
  // à direita seria cortado na última coluna.
  return (
    <Tooltip
      placement="top"
      label={
        <span className="source-tooltip">
          {/* O nome do PROGRAMA, quando dá pra saber: o título da janela
              ("monster tier list - Pesquisa Google - Google Chrome") nem
              sempre diz de que app ele é, e é justamente o que o card
              mostra embaixo. */}
          {source.appName && <span className="source-tooltip-app">{source.appName}</span>}
          <span className="source-tooltip-title">{source.name}</span>
        </span>
      }
    >
      <button
        type="button"
        className={selected ? 'source-item source-item-active' : 'source-item'}
        onClick={onSelect}
      >
        {source.thumbnailDataUrl ? (
          <img src={source.thumbnailDataUrl} alt="" className="source-thumbnail" />
        ) : (
          // Item pedido pelo usuário (2026-08-31): fontes que só vieram da
          // complementação via PowerShell (janelas minimizadas/em outra
          // área de trabalho, que o desktopCapturer não lista — ver
          // screenCapture.ts) não têm thumbnail nenhum pra mostrar. O
          // ícone do programa em tamanho grande é o que mais se aproxima
          // de "que janela é essa"; o ícone genérico ficou só pro caso de
          // nem isso existir.
          <div className="source-thumbnail-placeholder">
            {icon ? (
              <img src={icon} alt="" className="source-placeholder-icon" />
            ) : (
              <LayoutGrid size={28} />
            )}
          </div>
        )}
        {selected && (
          <span className="source-check-badge">
            <Check size={14} />
          </span>
        )}
        <span className="source-name">
          {icon && <img src={icon} alt="" className="source-name-icon" />}
          <span className="source-name-text">{source.name}</span>
        </span>
      </button>
    </Tooltip>
  )
}

export default CaptureSourceCard
