// As notas de versão que o app mostra pra quem usa (2026-09-25, pedido
// do usuário).
//
// ---------------------------------------------------------------------
// ⚠️ A CADA RELEASE: acrescentar a versão nova NO TOPO desta lista,
// ANTES de gerar o instalador. Ver "Antes dos passos: escrever as notas
// da versão" no RELEASE.md.
// ---------------------------------------------------------------------
//
// Uma nota que falta não quebra nada — a janela simplesmente não abre
// sozinha (ver useReleaseNotes.ts) —, e é justamente isso que torna o
// esquecimento silencioso: a atualização sai, e ninguém fica sabendo do
// que mudou.
//
// Escrito PRA USUÁRIO, e não pra quem programa: o que a pessoa vai
// notar usando o app, em uma linha cada. Nada de nome de arquivo, de
// função ou de API — quem quiser o detalhe técnico tem o ROADMAP.md.
//
// Mora no renderer, e não no servidor: as notas descrevem a versão
// INSTALADA, então viajar junto com ela é o que garante que as duas
// sempre combinem. Vindo do servidor, quem adiasse a atualização leria
// as novidades de uma versão que não tem.

export type ReleaseSectionKind = 'novidades' | 'melhorias' | 'correcoes'

// Os três rótulos possíveis. Um conjunto FECHADO de propósito: seções
// inventadas a cada release ("ajustes", "diversos", "outros") fariam
// cada versão ter uma cara, e a pessoa teria que reaprender a ler a
// janela toda vez.
export const SECTION_LABEL: Record<ReleaseSectionKind, string> = {
  novidades: 'Novidades',
  melhorias: 'Melhorias',
  correcoes: 'Correções'
}

export interface ReleaseSection {
  kind: ReleaseSectionKind
  items: string[]
}

export interface ReleaseNote {
  // Igual ao `version` do package.json, sem o "v" — é por ele que a
  // versão instalada é encontrada aqui dentro.
  version: string
  // ISO (YYYY-MM-DD). Formatado na hora de exibir, ver
  // `formatReleaseDate`.
  date: string
  // Uma frase sobre o conjunto, mostrada abaixo do número. Serve pra
  // quem só vai ler essa linha.
  summary: string
  // Só as seções que TÊM conteúdo. Uma seção vazia não entra — a janela
  // não desenha título sem itens embaixo.
  sections: ReleaseSection[]
}

// Da mais NOVA pra mais antiga: é a ordem em que aparecem na lista
// lateral, e a primeira é a que a janela abre quando não há outra
// escolha.
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.2.0',
    date: '2026-09-25',
    summary:
      'Chat ao vivo, lista de usuários reorganizada e uma transmissão que começa bem mais rápido.',
    sections: [
      {
        kind: 'novidades',
        items: [
          'Chat durante a live: converse com quem está assistindo sem sair do app. As mensagens existem só enquanto a transmissão está no ar e somem junto com ela.',
          'Quem está assistindo agora aparece em uma fila de fotos, no topo do chat e acima do rodapé da sua live.',
          'A lista de usuários passou a ser dividida em Online e Offline, com a quantidade de pessoas em cada uma.',
          'Você pode fixar alguém no topo da lista de usuários: passe o cursor sobre a pessoa e clique no alfinete. A escolha é só sua e fica guardada na sua conta.'
        ]
      },
      {
        kind: 'melhorias',
        items: [
          'A tela de escolher o que transmitir abre muito mais rápido, mesmo com muitas janelas abertas.',
          'O app lembra a qualidade (resolução e FPS) da sua última transmissão e já começa com ela selecionada.',
          'O jogo que você está jogando é reconhecido com mais precisão e aparece pra quem assiste.',
          'O convite para a sua live ficou sempre visível na lista de usuários, sem precisar procurar.'
        ]
      },
      {
        kind: 'correcoes',
        items: [
          'Trocar a foto de perfil passou a aparecer na hora para todo mundo, inclusive na lista de usuários.',
          'Um convite recusado não deixa mais o botão de convidar travado.'
        ]
      }
    ]
  }
]

// A nota de uma versão, ou `null` se aquela versão não tem nota escrita.
export function findRelease(version: string): ReleaseNote | null {
  return RELEASE_NOTES.find((note) => note.version === version) ?? null
}

// "2026-09-25" -> "25 de setembro de 2026".
//
// Montado do texto cru, sem `new Date(iso)`: o construtor lê "YYYY-MM-DD"
// como UTC e depois exibe no fuso local, o que no Brasil (UTC-3) faz toda
// data voltar um dia. A string já está no formato que queremos ler, então
// não há por que convertê-la pra instante nenhum.
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro'
]

export function formatReleaseDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const name = MONTHS[Number(month) - 1]
  if (!name) return iso
  return `${Number(day)} de ${name} de ${year}`
}
