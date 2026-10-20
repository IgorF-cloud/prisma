import { ReactNode } from 'react'
import { LayoutGrid } from 'lucide-react'
import Tooltip from './Tooltip'
import screenIcon from '../assets/monitor.png'

export interface CaptureSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnailDataUrl: string
  // Taxa de atualização (Hz) do monitor dessa fonte (2026-10-09). Não é
  // desenhada no card: quem usa é o dialog de fontes, pra montar as
  // opções de FPS (ver `fpsOptionsFor` em transmissionSettings.ts). Mora
  // aqui porque este tipo é o contrato da grade inteira.
  refreshHz: number | null
  // Só vem preenchido pra fontes de JANELA, e mesmo assim pode ser null
  // (processo protegido, ou o HWND do card não casou com a enumeração
  // nativa) — ver screenCapture.ts no main.
  appName: string | null
  iconDataUrl: string | null
}

interface CaptureSourceCardProps {
  source: CaptureSource
  // A fonte que a live está transmitindo agora (só no dialog de
  // atualizar) — ganha o selo "Transmitindo" no canto.
  current?: boolean
  actionLabel: string
  actionIcon: ReactNode
  onAction: () => void
}

// O desenho de monitor do app (o mesmo do tile da live no rodapé da
// Home, ver NowPlayingArt.tsx) — 2026-09-24, pedido do usuário. Fonte
// de TELA não tem programa dono nem ícone pra pedir ao Windows, então
// o lugar do ícone ficaria vazio só nela.
function iconForSource(source: CaptureSource): string | null {
  return source.type === 'screen' ? screenIcon : source.iconDataUrl
}

// Um tile da grade de fontes. Redesenhado em 2026-10-16 (pedido do
// usuário), junto com a troca da tela de iniciar por um dialog:
//
//   - O NOME E O ÍCONE SAÍRAM DE DENTRO DA MINIATURA. Ficam embaixo dela,
//     alinhados à esquerda — a imagem aparece inteira, sem a faixa
//     escura comendo o pé dela.
//   - NÃO HÁ MAIS SELEÇÃO. O TILE INTEIRO é o botão — miniatura e nome
//     (ajuste do usuário no mesmo dia): clicar em qualquer ponto dele já
//     é a escolha, e o dialog fecha. O "Compartilhar tela" do hover é só
//     uma etiqueta que diz o que o clique faz, não um botão à parte.
//
// O hover vale também pro foco de teclado (`:focus-visible` no CSS):
// quem navega por Tab precisa ver em qual tile está.
function CaptureSourceCard({
  source,
  current = false,
  actionLabel,
  actionIcon,
  onAction
}: CaptureSourceCardProps): React.JSX.Element {
  const icon = iconForSource(source)

  return (
    <button
      type="button"
      className={current ? 'source-tile source-tile-current' : 'source-tile'}
      onClick={onAction}
    >
      <div className="source-tile-frame">
        {source.thumbnailDataUrl ? (
          // `decoding="async"`: a decodificação não disputa a thread que
          // rola a grade (ver `decodificarMiniaturas` no dialog).
          <img
            src={source.thumbnailDataUrl}
            alt=""
            decoding="async"
            className="source-tile-thumbnail"
          />
        ) : (
          // A miniatura pode vir VAZIA (o Chromium entrega um thumbnail em
          // branco quando não consegue capturar a janela naquele
          // instante). O ícone do programa em tamanho grande é o que mais
          // se aproxima de "que janela é essa"; o genérico fica só pro
          // caso de nem isso existir.
          <div className="source-tile-placeholder">
            {icon ? (
              <img src={icon} alt="" className="source-tile-placeholder-icon" />
            ) : (
              <LayoutGrid size={28} />
            )}
          </div>
        )}

        {current && (
          <span className="source-tile-badge">
            <span className="source-tile-badge-dot" />
            Transmitindo
          </span>
        )}

        <div className="source-tile-overlay">
          <span className="source-tile-action">
            <span className="source-tile-action-icon">{actionIcon}</span>
            {actionLabel}
          </span>
        </div>
      </div>

      {/* Sem `title=` de propósito (2026-09-24, pedido do usuário): o
          tooltip nativo do Windows aparecia por cima do nosso. O balão
          mostra o nome do PROGRAMA quando dá pra saber — o título da
          janela nem sempre diz de que app ela é. */}
      <Tooltip
        placement="bottom"
        label={
          <span className="source-tooltip">
            {source.appName && <span className="source-tooltip-app">{source.appName}</span>}
            <span className="source-tooltip-title">{source.name}</span>
          </span>
        }
      >
        <span className="source-tile-label">
          {icon && <img src={icon} alt="" className="source-tile-label-icon" />}
          <span className="source-tile-label-text">{source.name}</span>
        </span>
      </Tooltip>
    </button>
  )
}

export default CaptureSourceCard
