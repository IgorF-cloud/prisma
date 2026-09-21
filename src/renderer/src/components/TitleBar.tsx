import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import iconName from '../assets/iconName.png'
import { formatAppVersion, VERSION_LABEL } from '../lib/appVersion'
import Tooltip from './Tooltip'

// TESTE (2026-09-03, pedido do usuário) — se não ficar bom, desfazer
// junto com o `titleBarStyle`/`titleBarOverlay` em src/main/index.ts.
// Com `titleBarStyle: 'hidden'`, o Windows para de desenhar o ícone e o
// texto do título sozinho (só os botões de minimizar/maximizar/fechar
// continuam nativos, via `titleBarOverlay`) — essa faixa aqui substitui
// a parte que sobrou. `-webkit-app-region: drag` (ver main.css) deixa
// essa faixa arrastável, igual uma titlebar de verdade.
//
// 2026-09-08 (pedido do usuário): o ícone do canto + o texto "Prisma"
// (que era Poppins 600) saíram e no lugar entrou a arte da marca inteira
// — `assets/iconName.png`. O lettering é branco com fundo transparente,
// então só funciona sobre o tema escuro; se um dia sair um tema claro,
// precisa de uma variante escura da arte.
//
// 2026-09-09 (pedido do usuário): no splash e nas telas de login/cadastro
// a faixa fica VAZIA — sem a arte e sem a versão. Essas telas já mostram a
// mesma arte, grande e centralizada (`.auth-branding`), e as duas juntas
// ficavam repetitivas.
//
// A faixa em si continua sendo renderizada nelas, e isso é essencial: é
// ela a área arrastável da janela (`-webkit-app-region: drag`) — sem ela
// não dá pra mover o app pela parte de cima. Por isso o componente não é
// simplesmente omitido nessas telas.
interface TitleBarProps {
  // Some junto a arte E a versão, então não é "showBrand": é a faixa
  // inteira ficar vazia ou não.
  showContent: boolean
  // Versão publicada mais nova que a instalada, ou null. Vem do
  // useAppUpdate (App.tsx), que descobre isso no login E em tempo real,
  // quando o servidor anuncia uma publicação.
  updateVersion: string | null
  onUpdateClick: () => void
}

function TitleBar({ showContent, updateVersion, onUpdateClick }: TitleBarProps): React.JSX.Element {
  // Busca própria (mesmo padrão do LoginScreen.tsx), não via
  // useAppUpdate — esse hook só liga depois do login (`enabled:
  // Boolean(user)`, ver App.tsx), e a titleBar precisa aparecer em
  // TODA tela, login incluso. `app:getVersion` é só `app.getVersion()`
  // puro, sem rede nenhuma.
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.api.app.getVersion().then(setAppVersion)
  }, [])

  return (
    <div className="app-titlebar">
      {showContent && (
        <>
          <img src={iconName} alt="Prisma" className="app-titlebar-logo" />
          {/* Os DOIS lado a lado (2026-09-17): o chip do canal e o
              número da versão. Antes o chip substituía o número, e a
              versão instalada não aparecia em lugar nenhum do app. Ver
              src/renderer/src/lib/appVersion.ts.

              O chip não espera o `getVersion()`: ele é constante e
              aparece no primeiro frame; o número entra quando o IPC
              responde. */}
          {VERSION_LABEL && <span className="app-titlebar-channel">{VERSION_LABEL}</span>}
          {appVersion && (
            <span className="app-titlebar-version">{formatAppVersion(appVersion)}</span>
          )}
        </>
      )}

      {/* ATUALIZAR (2026-09-20, pedido do usuário) — encostado nos botões
          de janela, à direita.
          ------------------------------------------------------------
          Só aparece com o usuário logado (`showContent`) e com uma
          versão publicada mais nova que a instalada. Ele sobrevive ao
          "agora não" do diálogo, inclusive entre reinícios do app: quem
          o acende é o FATO de existir atualização, não a sessão (ver
          useAppUpdate.ts).

          `-webkit-app-region: no-drag` no CSS é o que o torna clicável —
          a faixa inteira é área de arrastar a janela, e sem isso o
          clique viraria um arrasto. */}
      {showContent && updateVersion && (
        <Tooltip label={`v${updateVersion}`} placement="bottom" delayMs={0}>
          <button
            type="button"
            className="app-titlebar-update"
            onClick={onUpdateClick}
            aria-label={`Atualizar o Prisma para a versão ${updateVersion}`}
          >
            <Sparkles size={13} />
            Nova versão disponível
          </button>
        </Tooltip>
      )}
    </div>
  )
}

export default TitleBar
