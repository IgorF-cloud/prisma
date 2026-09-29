import { useEffect, useState } from 'react'
import { Bug, Gauge, Sparkles, X } from 'lucide-react'
import {
  findRelease,
  formatReleaseDate,
  ReleaseSectionKind,
  RELEASE_NOTES,
  SECTION_LABEL
} from '../lib/releaseNotes'
import { formatAppVersion } from '../lib/appVersion'

interface ReleaseNotesModalProps {
  // Versão que a janela abre selecionada — ver useReleaseNotes.ts.
  initialVersion: string
  // A versão INSTALADA, pra marcar qual das da lista é a que está
  // rodando. Normalmente é a primeira; não é, por exemplo, numa build de
  // teste à frente das notas.
  installedVersion: string
  onClose: () => void
}

// Um ícone e uma cor por tipo de seção. Mapa e não `if`: seção nova
// entra aqui e em SECTION_LABEL, e o resto sai de graça.
//
// As cores são as que o app já usa e significam a mesma coisa que no
// resto dele: roxo é destaque/ação (o que há de novo), verde é bom
// acontecendo (o que melhorou) e cinza é neutro (o que estava quebrado e
// não está mais). Um vermelho aqui gritaria "perigo" numa lista que só
// tem boas notícias.
const SECTION_ICON: Record<ReleaseSectionKind, typeof Sparkles> = {
  novidades: Sparkles,
  melhorias: Gauge,
  correcoes: Bug
}

// Janela de "Notas da atualização" (2026-09-25, pedido do usuário).
//
// Abre sozinha UMA vez a cada versão nova (useReleaseNotes.ts) e a
// qualquer momento pelo link da titlebar. Duas colunas: as versões à
// esquerda, o que mudou naquela versão à direita.
//
// O conteúdo vem de releaseNotes.ts, que viaja junto com o app — ver lá
// o porquê de não vir do servidor.
function ReleaseNotesModal({
  initialVersion,
  installedVersion,
  onClose
}: ReleaseNotesModalProps): React.JSX.Element {
  // A versão escolhida na lista. Só o valor INICIAL vem de fora: depois
  // de aberta, a janela é dona da própria navegação.
  const [selected, setSelected] = useState(
    () => findRelease(initialVersion)?.version ?? RELEASE_NOTES[0]?.version ?? ''
  )

  // A titlebar precisa ir pro plano de baixo enquanto isto está aberto —
  // ver a explicação inteira no UpdateDialog.tsx. Vale ainda mais aqui:
  // é DA titlebar que sai o link que abre esta janela, e sem isto ele
  // continuaria clicável por cima do escurecido.
  useEffect(() => {
    document.body.classList.add('app-dialog-open')
    return () => document.body.classList.remove('app-dialog-open')
  }, [])

  // Esc fecha. `keydown` no documento e não no painel: o foco pode estar
  // em qualquer botão da lista, ou em nenhum.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const note = findRelease(selected)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* O clique morre no painel: sem isto, clicar em qualquer lugar de
          dentro fecharia a janela, porque o fundo escuro é o ancestral
          de tudo aqui. */}
      <div
        className="release-notes"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Notas da atualização"
      >
        <header className="release-notes-header">
          <span className="release-notes-header-icon">
            <Sparkles size={16} />
          </span>
          <div className="release-notes-heading">
            <h2 className="release-notes-title">Notas da atualização</h2>
            <p className="release-notes-subtitle">O que mudou em cada versão do Prisma</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="release-notes-body">
          <nav className="release-notes-versions" aria-label="Versões">
            {RELEASE_NOTES.map((item) => (
              <button
                key={item.version}
                type="button"
                className={`release-notes-version${
                  item.version === selected ? ' release-notes-version-active' : ''
                }`}
                onClick={() => setSelected(item.version)}
                aria-current={item.version === selected}
              >
                <span className="release-notes-version-number">
                  {formatAppVersion(item.version)}
                  {/* "atual" marca a versão que está RODANDO, que nem
                      sempre é a primeira da lista. É o que responde
                      "isto que estou lendo já está no meu app?" sem
                      precisar conferir o número na faixa de cima. */}
                  {item.version === installedVersion && (
                    <span className="release-notes-version-tag">atual</span>
                  )}
                </span>
                <span className="release-notes-version-date">{formatReleaseDate(item.date)}</span>
              </button>
            ))}
          </nav>

          <section className="release-notes-content">
            {!note ? (
              // Só acontece com a lista vazia (nenhuma nota escrita). A
              // janela ainda pode ser aberta pelo link da titlebar, e
              // uma coluna em branco pareceria defeito.
              <p className="release-notes-empty">Nenhuma nota publicada ainda.</p>
            ) : (
              <>
                <div className="release-notes-content-head">
                  <h3 className="release-notes-content-version">Versão {note.version}</h3>
                  <span className="release-notes-content-date">{formatReleaseDate(note.date)}</span>
                </div>
                <p className="release-notes-summary">{note.summary}</p>

                {note.sections.map((section) => {
                  const Icon = SECTION_ICON[section.kind]
                  return (
                    <div
                      key={section.kind}
                      className={`release-notes-section release-notes-section-${section.kind}`}
                    >
                      <h4 className="release-notes-section-title">
                        <Icon size={13} />
                        {SECTION_LABEL[section.kind]}
                      </h4>
                      <ul className="release-notes-items">
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default ReleaseNotesModal
