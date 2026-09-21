import { AvatarRef, customAvatarUrl } from '../lib/avatar'
import placeholderAvatar from '../assets/user.png'

interface UserAvatarProps {
  avatar: AvatarRef | null | undefined
  apiBaseUrl: string
  size?: number
}

// Roadmap item 43: renderiza o CONTEÚDO do avatar — a foto customizada
// (que preenche o círculo do container, responsável só por
// tamanho/borda/sombra/overflow, ver main.css) ou o placeholder padrão.
//
// É o ÚNICO lugar que desenha avatar no app inteiro: footer, tile de
// sala, listas de viewers, box de perfil, sidebar de usuários e até a
// janela da sobreposição (ViewerOverlay.tsx) passam por aqui. Mudar o
// placeholder aqui muda em todos de uma vez — foi por isso que o pedido
// de 2026-09-11 ("muda em todos os lugares onde ele apareceria") virou
// uma edição só.
//
// ---------------------------------------------------------------------
// O PLACEHOLDER (2026-09-11, pedido do usuário)
//
// Cinza médio + boneco branco PREENCHIDO. Antes era o roxo do app
// (`var(--accent)`) com o ícone só de contorno.
//
// Duas mudanças de fundo, e as duas têm razão:
//
//   - O roxo é a cor de DESTAQUE do app (botões principais, seleção,
//     acento). Usá-lo como "não tem foto" dava ao estado mais neutro que
//     existe o mesmo peso visual de um botão de ação. Cinza diz
//     "ausência" sem competir com nada.
//
//   - Os PRESETS de cor deixaram de valer aqui. Eles eram uma escolha
//     manual que saiu do app no item 43, mas a cor continuava sendo
//     respeitada pra quem tivesse um gravado — o que fazia duas contas
//     sem foto aparecerem diferentes uma da outra. Agora quem não tem
//     FOTO tem exatamente o mesmo placeholder, e `getPresetColor` deixou
//     de ser usado (segue exportado em lib/avatar.ts, sem chamador).
// ---------------------------------------------------------------------
//
// O boneco deixou de ser o ícone `UserRound` do lucide em 2026-09-13: o
// usuário desenhou um PNG próprio (cabeça em branco a 40% + ombros em
// branco sólido) e pediu pra usar em todo lugar. O fundo cinza continua
// sendo pintado aqui — o PNG é só a silhueta, com transparência em volta.
//
// ⚠️ O desenho vive em `src/renderer/src/assets/user.png`, e SÓ ali: é o
// que está dentro de `src/renderer` que entra no bundle do renderer. Ele
// chegou em `resources/` (que é território do processo main), foi copiado
// pra cá e a cópia de lá foi apagada em 2026-09-14 — ter o mesmo arquivo
// nos dois lugares só criaria a dúvida de qual é o que vale.
//
// O mesmo serve pros três placeholders de "o que está sendo transmitido"
// (monitor, janela, Steam), em `NowPlayingArt.tsx`.
const PLACEHOLDER_BACKGROUND = '#4a4a52'

function UserAvatar({ avatar, apiBaseUrl, size = 20 }: UserAvatarProps): React.JSX.Element {
  if (avatar?.type === 'custom') {
    return <img src={customAvatarUrl(apiBaseUrl, avatar)} alt="" className="user-avatar-photo" />
  }

  return (
    <div className="user-avatar-fallback" style={{ backgroundColor: PLACEHOLDER_BACKGROUND }}>
      {/* `size` continua significando a mesma coisa que significava pro
          ícone do lucide — o tamanho do BONECO dentro do círculo, não o
          do círculo (esse vem do container, ver main.css). Assim nenhuma
          das dez chamadas espalhadas pelo app precisou mudar. */}
      <img
        src={placeholderAvatar}
        alt=""
        className="user-avatar-placeholder"
        style={{ width: size, height: size }}
      />
    </div>
  )
}

export default UserAvatar
