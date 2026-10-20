import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Gauge,
  Layers,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react'
import {
  formatReleaseDate,
  groupReleases,
  majorOf,
  ReleaseGroup,
  ReleaseNote,
  ReleaseSectionKind,
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
  // As versões que chegaram desde a última visita (2026-10-19) — ver
  // `unseenReleases` em releaseNotes.ts. Vazia quando não há novidade.
  newVersions: string[]
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

// As seções de uma nota — o mesmo desenho na nota principal e dentro do
// cartão de uma atualização.
function ReleaseSections({ note }: { note: ReleaseNote }): React.JSX.Element {
  return (
    <>
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
  )
}

function pluralUpdates(count: number): string {
  return count === 1 ? '1 atualização' : `${count} atualizações`
}

// Janela de "Notas da atualização" (2026-09-25, pedido do usuário).
//
// Abre sozinha UMA vez a cada versão nova (useReleaseNotes.ts) e a
// qualquer momento pelo link da titlebar. Duas colunas: as versões à
// esquerda, o que mudou naquela versão à direita.
//
// Desde 2026-10-19 a lista é por versão PRINCIPAL ("v1.5"): a 1.5.0 é a
// nota grande, e as 1.5.x entram como tiles no topo (que rolam até
// elas) e como seções abaixo do lançamento (2026-10-20) — quem atualiza da 1.5.0 pra 1.5.1 continua vendo o que a 1.5
// trouxe, mais o que a correção mudou. Só aqui o número é encurtado; no
// resto do app ele aparece inteiro.
//
// O conteúdo vem de releaseNotes.ts, que viaja junto com o app — ver lá
// o porquê de não vir do servidor.
function ReleaseNotesModal({
  initialVersion,
  installedVersion,
  newVersions,
  onClose
}: ReleaseNotesModalProps): React.JSX.Element {
  const groups = useMemo(() => groupReleases(), [])

  // O grupo escolhido na lista. Só o valor INICIAL vem de fora: depois
  // de aberta, a janela é dona da própria navegação.
  const [selected, setSelected] = useState(() => {
    const key = majorOf(initialVersion)
    return groups.some((group) => group.key === key) ? key : (groups[0]?.key ?? '')
  })

  // Os grupos com alguma versão que a pessoa ainda não tinha visto
  // (2026-10-19). Da 1.4.1 pra 1.5.1 são duas versões, mas UM grupo: a
  // faixa conta "versões" como a lista mostra.
  const newGroups = groups.filter((group) =>
    [group.base, ...group.patches].some((note) => note && newVersions.includes(note.version))
  )
  const isNewGroup = (key: string): boolean => newGroups.some((group) => group.key === key)
  const isNew = (version: string): boolean => newVersions.includes(version)

  // Quais dos grupos novos a pessoa já abriu NESTA janela. É o que apaga
  // o pontinho de "não lida" e marca o passo da faixa de cima — quem
  // ficou três versões fora vê quanto falta ler. O aberto de início já
  // conta como lido: está na tela.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([selected]))

  function select(key: string): void {
    setSelected(key)
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }

  // A faixa de "você perdeu N versões" só aparece com DUAS ou mais: com
  // uma só, o chip na lista já diz tudo, e uma faixa anunciando "1
  // versão" seria barulho em cima da abertura de toda versão.
  const showCatchUp = newGroups.length >= 2
  // Na faixa, da mais antiga pra mais nova: é a ordem em que as coisas
  // aconteceram, e a que se lê como uma linha do tempo.
  const catchUpSteps = [...newGroups].reverse()
  const readCount = newGroups.filter((group) => visited.has(group.key)).length
  const firstOld = groups.find((group) => !isNewGroup(group.key))?.key

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

  const group: ReleaseGroup | undefined = groups.find((item) => item.key === selected)
  // A data que a lista mostra: a do lançamento da versão principal; sem
  // ela, a da primeira atualização.
  const groupDate = (item: ReleaseGroup): string =>
    item.base?.date ?? item.patches[item.patches.length - 1]?.date ?? ''
  const isInstalledGroup = (item: ReleaseGroup): boolean =>
    item.key === majorOf(installedVersion)

  // As atualizações na ordem em que SAÍRAM (a lista guarda da mais nova
  // pra mais antiga): é como a faixa de cima e as seções de baixo leem,
  // como uma linha do tempo a partir do lançamento.
  const patchesInOrder = group ? [...group.patches].reverse() : []

  const contentRef = useRef<HTMLElement>(null)
  const patchRefs = useRef(new Map<string, HTMLElement>())
  // A seção que acabou de receber o scroll de um tile: brilha por um
  // instante, pra o olho achar onde caiu.
  const [highlighted, setHighlighted] = useState<string | null>(null)

  function scrollToPatch(version: string): void {
    patchRefs.current.get(version)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setHighlighted(version)
  }

  useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setHighlighted(null), 1600)
    return () => clearTimeout(timer)
  }, [highlighted])

  // Trocar de versão na lista volta o conteúdo pro topo: sem isto, a
  // versão nova abriria rolada até onde a anterior estava.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
    setHighlighted(null)
  }, [selected])

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

        {/* "Você perdeu N versões" (2026-10-19, pedido do usuário). Quem
            ficou várias versões sem abrir o app via só a última em
            destaque, e as outras passavam batido. A faixa conta quantas
            chegaram e põe todas numa linha do tempo clicável, cada passo
            ganhando um check quando é aberto. */}
        {showCatchUp && (
          <div className="release-notes-catchup">
            <span className="release-notes-catchup-icon">
              <Layers size={16} />
            </span>
            <div className="release-notes-catchup-text">
              <strong className="release-notes-catchup-title">
                {newGroups.length} versões novas desde a sua última visita
              </strong>
              <span className="release-notes-catchup-subtitle">
                {readCount < newGroups.length
                  ? `Veja o que mudou em cada uma — ${readCount} de ${newGroups.length} vistas`
                  : 'Tudo em dia! Você já viu todas as novidades.'}
              </span>
            </div>
            <div className="release-notes-catchup-steps">
              {catchUpSteps.map((step, index) => {
                const read = visited.has(step.key)
                return (
                  <Fragment key={step.key}>
                    {index > 0 && (
                      <ChevronRight size={12} className="release-notes-catchup-arrow" />
                    )}
                    <button
                      type="button"
                      className={`release-notes-catchup-step${
                        step.key === selected ? ' release-notes-catchup-step-active' : ''
                      }${read ? ' release-notes-catchup-step-read' : ''}`}
                      onClick={() => select(step.key)}
                    >
                      {read && <Check size={11} strokeWidth={3} />}
                      {formatAppVersion(step.key)}
                    </button>
                  </Fragment>
                )
              })}
            </div>
          </div>
        )}

        <div className="release-notes-body">
          <nav className="release-notes-versions" aria-label="Versões">
            {groups.map((item) => {
              const fresh = isNewGroup(item.key)
              return (
                <Fragment key={item.key}>
                  {/* Os dois grupos só ganham título quando HÁ versão
                      nova: sem ela, "Anteriores" sobre a lista inteira
                      não separaria nada. */}
                  {newGroups.length > 0 && item.key === newGroups[0].key && (
                    <span className="release-notes-group release-notes-group-new">
                      <Sparkles size={10} />
                      Novas para você
                      <span className="release-notes-group-count">{newGroups.length}</span>
                    </span>
                  )}
                  {newGroups.length > 0 && item.key === firstOld && (
                    <span className="release-notes-group">Anteriores</span>
                  )}
                  <button
                    type="button"
                    className={`release-notes-version${
                      item.key === selected ? ' release-notes-version-active' : ''
                    }${fresh ? ' release-notes-version-new' : ''}`}
                    onClick={() => select(item.key)}
                    aria-current={item.key === selected}
                  >
                    <span className="release-notes-version-number">
                      {formatAppVersion(item.key)}
                      {/* "atual" marca a versão que está RODANDO, que nem
                          sempre é a primeira da lista. É o que responde
                          "isto que estou lendo já está no meu app?" sem
                          precisar conferir o número na faixa de cima. */}
                      {isInstalledGroup(item) && (
                        <span className="release-notes-version-tag">atual</span>
                      )}
                      {/* O pontinho de "ainda não lida": some no clique. */}
                      {fresh && !visited.has(item.key) && (
                        <span className="release-notes-version-unread" aria-label="não lida" />
                      )}
                    </span>
                    <span className="release-notes-version-date">
                      {formatReleaseDate(groupDate(item))}
                    </span>
                    {item.patches.length > 0 && (
                      <span className="release-notes-version-updates">
                        <RefreshCw size={9} />+{pluralUpdates(item.patches.length)}
                      </span>
                    )}
                  </button>
                </Fragment>
              )
            })}
          </nav>

          <section className="release-notes-content" ref={contentRef}>
            {!group ? (
              // Só acontece com a lista vazia (nenhuma nota escrita). A
              // janela ainda pode ser aberta pelo link da titlebar, e
              // uma coluna em branco pareceria defeito.
              <p className="release-notes-empty">Nenhuma nota publicada ainda.</p>
            ) : (
              <>
                <div className="release-notes-content-head">
                  <h3 className="release-notes-content-version">Versão {group.key}</h3>
                  <span className="release-notes-content-date">
                    {formatReleaseDate(groupDate(group))}
                  </span>
                  {group.base && isNew(group.base.version) && (
                    <span className="release-notes-content-new">
                      <Sparkles size={10} />
                      Nova para você
                    </span>
                  )}
                </div>

                {/* Faixa de atualizações (2026-10-20, pedido do usuário): um
                    tile por X.Y.Z, na ordem em que saíram. O clique rola o
                    conteúdo até a seção dela, lá embaixo — o topo fica
                    com o resumo de quantas vieram, e a nota grande
                    continua sendo a primeira coisa a ler. */}
                {patchesInOrder.length > 0 && (
                  <div className="release-notes-patch-strip">
                    <span className="release-notes-patch-strip-label">
                      <RefreshCw size={10} />
                      Atualizações desta versão
                      <span className="release-notes-patch-strip-count">
                        {patchesInOrder.length}
                      </span>
                    </span>
                    <div className="release-notes-patch-tiles">
                      {patchesInOrder.map((patch) => (
                        <button
                          key={patch.version}
                          type="button"
                          className={`release-notes-patch-tile${
                            isNew(patch.version) ? ' release-notes-patch-tile-new' : ''
                          }`}
                          onClick={() => scrollToPatch(patch.version)}
                        >
                          <span className="release-notes-patch-icon">
                            <RefreshCw size={13} />
                          </span>
                          <span className="release-notes-patch-tile-text">
                            <span className="release-notes-patch-tile-title">
                              {patch.version}
                              {patch.version === installedVersion && (
                                <span className="release-notes-version-tag">atual</span>
                              )}
                              {isNew(patch.version) && (
                                <span className="release-notes-content-new">
                                  <Sparkles size={10} />
                                  Nova
                                </span>
                              )}
                            </span>
                            <span className="release-notes-patch-date">
                              {formatReleaseDate(patch.date)}
                            </span>
                          </span>
                          <ChevronDown size={14} className="release-notes-patch-tile-arrow" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {group.base && (
                  <>
                    <p className="release-notes-summary">{group.base.summary}</p>
                    <ReleaseSections note={group.base} />
                  </>
                )}

                {/* As atualizações em si, ABAIXO do lançamento, uma embaixo
                    da outra e na ordem em que saíram: lidas de cima pra
                    baixo, contam a história da versão. */}
                {patchesInOrder.length > 0 && (
                  <>
                    <div className="release-notes-base-divider">
                      <span>
                        {pluralUpdates(patchesInOrder.length)} da versão {group.key}
                      </span>
                    </div>
                    <div className="release-notes-patches">
                      {patchesInOrder.map((patch) => (
                        <article
                          key={patch.version}
                          ref={(node) => {
                            if (node) patchRefs.current.set(patch.version, node)
                            else patchRefs.current.delete(patch.version)
                          }}
                          className={`release-notes-patch${
                            isNew(patch.version) ? ' release-notes-patch-new' : ''
                          }${highlighted === patch.version ? ' release-notes-patch-highlight' : ''}`}
                        >
                          <header className="release-notes-patch-head">
                            <span className="release-notes-patch-icon">
                              <RefreshCw size={13} />
                            </span>
                            <div className="release-notes-patch-heading">
                              <span className="release-notes-patch-title">
                                Atualização {patch.version}
                                {patch.version === installedVersion && (
                                  <span className="release-notes-version-tag">atual</span>
                                )}
                                {isNew(patch.version) && (
                                  <span className="release-notes-content-new">
                                    <Sparkles size={10} />
                                    Nova
                                  </span>
                                )}
                              </span>
                              <span className="release-notes-patch-date">
                                {formatReleaseDate(patch.date)}
                              </span>
                            </div>
                          </header>
                          <p className="release-notes-patch-summary">{patch.summary}</p>
                          <div className="release-notes-patch-sections">
                            <ReleaseSections note={patch} />
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default ReleaseNotesModal
