import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import logoRender from '../assets/logo_render.png'
import { formatAppVersion, VERSION_LABEL } from '../lib/appVersion'
import { RELEASE_NOTES } from '../lib/releaseNotes'
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
// 2026-09-25 (pedido do usuário): a arte pronta saiu DESTA faixa e o
// par voltou a ser símbolo + texto — agora `assets/logo_render.png` e um
// "PRISMA" escrito em CSS. A diferença prática de ter o nome como texto
// é que ele acompanha a tipografia do app, fica nítido em qualquer DPI e
// pode ser lido/traduzido; a arte continua em uso no splash e nas telas
// de login, que não mudaram.
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
  // Abre a janela de notas. Vem de fora (App.tsx) porque a MESMA janela
  // também abre sozinha depois de uma atualização — quem decide isso é
  // o useReleaseNotes, que vive lá.
  onNotesClick: () => void
}

function TitleBar({
  showContent,
  updateVersion,
  onUpdateClick,
  onNotesClick
}: TitleBarProps): React.JSX.Element {
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
          {/* `alt` vazio de propósito: o nome vem logo ao lado, em
              texto de verdade. Descrito aqui também, a marca seria
              anunciada duas vezes por um leitor de tela. */}
          <img src={logoRender} alt="" className="app-titlebar-logo" />
          <span className="app-titlebar-brand">PRISMA</span>
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
          {/* NOTAS DA ATUALIZAÇÃO (2026-09-25, pedido do usuário) —
              logo depois do número, como uma continuação dele.

              Sem moldura e sem ícone: no hover só muda a cor e o cursor.
              É um link, não um botão de ação — a faixa já tem um botão
              de verdade (o de atualizar, à direita), e dois elementos
              com peso de botão numa faixa de 32px disputariam a atenção.

              Some junto com a lista vazia: um link que abre uma janela
              dizendo "não há nada" é pior que link nenhum. */}
          {RELEASE_NOTES.length > 0 && (
            <>
              {appVersion && (
                <span className="app-titlebar-separator" aria-hidden="true">
                  -
                </span>
              )}
              <button type="button" className="app-titlebar-notes" onClick={onNotesClick}>
                Notas da atualização
              </button>
            </>
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
      {/* O lado DIREITO da faixa (2026-10-21) num grupo só, encostado nos
          botões de janela: hoje só o "atualizar" (o botão de Notificações
          que viria na etapa 8 saiu do plano em 2026-10-22 — os alertas não
          têm lista). O de Membros morou aqui até 2026-10-21, quando foi
          pra barra da esquerda, abaixo da Lista de amigos. Num grupo porque o
          `margin-left: auto` empurra UM item — com dois itens soltos, o
          espaço livre se dividiria entre eles. */}
      {showContent && updateVersion && (
        <div className="app-titlebar-actions">
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
        </div>
      )}
    </div>
  )
}

export default TitleBar
