import { AvatarRef } from '../lib/avatar'
import Tooltip from './Tooltip'
import UserAvatar from './UserAvatar'

// A LINHA DE AVATARES de quem está assistindo (2026-09-23, pedido do
// usuário). Dois lugares, um componente:
//
//   - na ficha de uma sala assistida, é o que a lista vertical VIRA
//     quando o chat abre (ver RoomDetailsSidebar.tsx);
//   - na barra do chat do host, é a lista de espectadores da MINHA live,
//     que deixou de ter aba própria no rodapé (ver HomeScreen.tsx).
//
// Ele não sabe de sala nem de chat: recebe nomes e devolve cliques.

// Quantos avatares aparecem antes de emendar "…" quando a casca não pede
// outro número. As duas BARRAS que usam isto têm 280px, menos 32 de
// padding = 248 úteis, e cada avatar depois do primeiro custa 18px (26 do
// chip menos 8 de sobreposição). Com os ~26px do "…" no fim, 11 é o
// último que cabe inteiro — daí o corte ser um número conhecido, e não
// uma medição em tempo de execução.
//
// O bloco de espectadores do RODAPÉ (`.footer-viewers`, 2026-09-29 —
// antes era a pílula `.host-chat-bar-viewers` na linha acima dele) pede
// 10: lá a largura não é fixa, então o corte é uma escolha de desenho e
// não uma consequência da caixa.
const DEFAULT_MAX = 11

interface ViewerAvatarRowProps {
  names: string[]
  userAvatars: Record<string, AvatarRef>
  apiBaseUrl: string
  // `false` enquanto a linha está invisível (a ficha da sala a mantém no
  // DOM com opacidade zero pra ter o que animar) — tira os botões do Tab
  // e o tooltip do caminho, sem desmontar nada.
  interactive?: boolean
  // Quem o host silenciou. Sem a lista vertical, este anel vermelho virou
  // o único lugar em que ele vê de quem tirou a voz.
  mutedNames?: Set<string>
  // Qual ficha de usuário está aberta — o chip correspondente fica aceso,
  // como o <li> da lista vertical já ficava.
  activeName?: string | null
  // Quantos avatares cabem antes do "…". Ver DEFAULT_MAX acima.
  max?: number
  onViewerClick: (event: React.MouseEvent<HTMLButtonElement>, name: string) => void
  // Só o host passa isto: botão direito abre o menu de "Expulsar".
  onViewerContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, name: string) => void
}

function ViewerAvatarRow({
  names,
  userAvatars,
  apiBaseUrl,
  interactive = true,
  mutedNames,
  activeName,
  max = DEFAULT_MAX,
  onViewerClick,
  onViewerContextMenu
}: ViewerAvatarRowProps): React.JSX.Element {
  const hidden = names.length - max

  return (
    <div className="viewer-avatar-row">
      {names.slice(0, max).map((name) => {
        const classes = ['viewer-avatar-chip']
        if (mutedNames?.has(name)) classes.push('viewer-avatar-chip-muted')
        if (activeName === name) classes.push('viewer-avatar-chip-active')
        return (
          // O nome no NOSSO balão, não no `title` do sistema: o nativo
          // demora ~1s, aparece no canto do cursor e não tem nada a ver
          // com o resto do app. `delayMs={0}` porque numa fila de
          // avatares o nome é a única forma de saber em quem se vai
          // clicar — esperar por ele seria esperar pela informação.
          <Tooltip key={name} label={name} placement="top" delayMs={0}>
            <button
              type="button"
              className={classes.join(' ')}
              onClick={(event) => onViewerClick(event, name)}
              onContextMenu={
                onViewerContextMenu ? (event) => onViewerContextMenu(event, name) : undefined
              }
              tabIndex={interactive ? 0 : -1}
              aria-hidden={!interactive}
              aria-label={`Ver perfil de ${name}`}
            >
              <UserAvatar avatar={userAvatars[name]} apiBaseUrl={apiBaseUrl} size={13} />
            </button>
          </Tooltip>
        )
      })}

      {hidden > 0 && (
        <Tooltip label={`e mais ${hidden}`} placement="top" delayMs={0}>
          <span className="viewer-avatar-more">…</span>
        </Tooltip>
      )}
    </div>
  )
}

export default ViewerAvatarRow
