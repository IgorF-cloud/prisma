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
    version: '1.5.1',
    date: '2026-10-19',
    summary: 'Uma correção rápida para o avatar em GIF.',
    sections: [
      {
        kind: 'correcoes',
        items: [
          'O avatar em GIF agora fica animado de verdade. Na versão anterior, o GIF enviado era salvo como foto parada — se você já tinha enviado um, é só enviar de novo.'
        ]
      }
    ]
  },
  {
    version: '1.5.0',
    date: '2026-10-19',
    summary:
      'Agora dá para usar um GIF como avatar! Envie um GIF animado pela janela de Perfil e ele aparece se mexendo em todo lugar do Prisma — no app e no Prisma Web.',
    sections: [
      {
        kind: 'novidades',
        items: [
          'Seu avatar agora pode ser um GIF animado: envie um pela janela de Perfil e ele aparece se mexendo em todo lugar do Prisma, no app e no Prisma Web.',
          'Nova janela de Perfil: clique no seu avatar e em "Ver perfil" para ver e editar sua foto e seu nome, com tudo explicado.',
          'Agora dá para trocar a senha pelo próprio app, direto na janela de Perfil: enviamos um código para o seu e-mail, você confirma e escolhe a senha nova — sem precisar sair da conta.'
        ]
      },
      {
        kind: 'melhorias',
        items: [
          'As miniaturas das janelas e das telas na hora de escolher o que transmitir ficaram mais nítidas.',
          'A lista de janelas não trava mais a rolagem quando se atualiza sozinha.',
          'Quem assiste agora também ouve o som de entrada ao entrar numa live, e o de saída ao sair dela.'
        ]
      },
      {
        kind: 'correcoes',
        items: [
          'Entrar no app com uma live já no ar não toca mais o som de "live nova". O som continua tocando quando alguém entra ao vivo depois.',
          'A lista de jogos reconhecidos voltou a ser atualizada ao abrir o app, agora em segundo plano durante o carregamento.',
          'A tela principal já abre com a lista de lives atualizada, logo depois do login.',
          'Janelas que não estão abertas de verdade não aparecem mais na lista de janelas.',
          'Depois que quem transmite atualizava a live (trocando a fonte, a resolução ou o FPS), quem estava assistindo podia ficar sem ouvir o som. Corrigido.'
        ]
      }
    ]
  },
  {
    version: '1.4.1',
    date: '2026-10-17',
    summary: 'Uma atualização de correções para deixar as suas lives mais lisas.',
    sections: [
      {
        kind: 'correcoes',
        items: [
          'Transmitindo a tela inteira, a live podia congelar a cada segundo para quem estava assistindo. Corrigido.',
          'As opções de FPS voltaram a ser 30 e 60 em qualquer monitor.'
        ]
      }
    ]
  },
  {
    version: '1.4.0',
    date: '2026-10-16',
    summary:
      'Uma versão focada em transmitir melhor: lives mais estáveis e fluidas, início muito mais rápido e um visual mais caprichado em todo o app.',
    sections: [
      {
        kind: 'melhorias',
        items: [
          'Lives mais estáveis: revisamos todo o caminho da transmissão, de quem transmite até quem assiste, para reduzir travamentos e engasgos — inclusive com várias lives no ar ao mesmo tempo.',
          'Menos atraso entre o que acontece na sua tela e o que os espectadores veem, deixando a live mais próxima do tempo real.',
          'O FPS da transmissão agora acompanha o ritmo do jogo e do seu monitor, para uma imagem mais lisa e sem tremidas.',
          'Mudamos a forma de iniciar uma live: ficou mais simples e muito mais rápido entrar no ar.',
          'A tela de escolher o que transmitir ganhou um layout e um design novos.',
          'A lista de janelas e telas abre mais rápido e se atualiza sozinha — abriu um jogo ou um programa, ele já aparece para ser escolhido.',
          'O som da live ficou mais resistente a oscilações de internet, com menos cortes para quem está assistindo.',
          'As estatísticas da live agora abrem com um clique e ficam visíveis enquanto você precisar, com mais informações sobre a qualidade da transmissão.',
          'Demos um trato no visual do aplicativo: telas, ícones, botões e detalhes de acabamento ficaram mais bonitos e mais consistentes entre si.',
          'Melhorias gerais de desempenho e estabilidade, para o app responder mais rápido no dia a dia.'
        ]
      },
      {
        kind: 'correcoes',
        items: [
          'A lista de transmissão não mostra mais janelas duplicadas nem janelas internas do Windows que não deveriam estar lá.',
          'Corrigidos pequenos detalhes de visual que apareciam fora do padrão em algumas telas.'
        ]
      }
    ]
  },
  {
    version: '1.3.0',
    date: '2026-10-01',
    summary:
      'Recuperação de senha por e-mail, o Prisma para assistir pelo navegador e uma lista de transmissões que mostra só o que está mesmo no ar.',
    sections: [
      {
        kind: 'novidades',
        items: [
          'Esqueceu a senha? Agora dá pra recuperar sozinho: na tela de login, clique em "Esqueci minha senha" e um código de 6 dígitos chega no e-mail da conta. Ele vale por 15 minutos. Ao trocar a senha, todos os aparelhos conectados naquela conta são desconectados — inclusive o de quem tivesse entrado nela sem você saber.',
          'Agora dá pra assistir às lives pelo navegador, em prisma-site.com.br/app — no computador ou no celular, sem instalar nada. É o mesmo Prisma, com as mesmas lives, o mesmo chat e a mesma lista de usuários; só não dá pra transmitir por lá.'
        ]
      },
      {
        kind: 'melhorias',
        items: [
          'Só quem iniciou uma transmissão pode encerrá-la.',
          'Na lista de usuários, cada pessoa tem um menu próprio: passe o mouse sobre ela e clique na setinha. É de lá que saem "Fixar/Desfixar" e "Convidar para a live", que antes eram dois botões soltos.',
          'Ficou mais fácil identificar cada um na lista: quem você fixou se destaca no tile, e quem já está assistindo a sua live aparece marcado. Quando não dá pra convidar alguém, o menu diz o motivo.',
          'Convidar ficou mais simples: a opção é sempre a mesma e pode ser clicada quantas vezes você quiser. A regra continua — enquanto a pessoa não responder, um novo clique não manda outro convite nem mexe no tempo que ela tem pra responder.',
          'As informações da sua transmissão foram reunidas no rodapé: quem está assistindo agora fica ali, ao lado dos dados da live, e enquanto ela sobe o rodapé avisa que está iniciando. O selo da sua live virou "LIVE" em vermelho — o verde continua marcando as lives dos outros.',
          'Detalhes de leitura: nomes compridos de jogo ou de janela deslizam em vez de terminar em reticências, e a aba do chat de uma sala acende em laranja quando chega mensagem nova.',
          'Transmitindo uma JANELA, o jogo ou programa já vai junto desde o primeiro instante. Transmitindo um MONITOR inteiro, aparece primeiro o nome da tela e, alguns segundos depois, o jogo que for detectado.',
          'O volume com que você assiste fica guardado: mexeu no volume (ou deixou no mudo), a próxima live que você entrar já começa assim. Assistindo a várias ao mesmo tempo, mudar o volume de uma continua sem mexer no volume das outras.',
          'Os botões de controle da sua live, no rodapé, agora dizem para que servem: parando o mouse em cima aparece "Preview", "Definições" ou "Parar transmissão".',
          'O áudio da sua transmissão vai com o dobro de qualidade e sempre em estéreo. Antes ele saía abafado, e em algumas máquinas chegava mono pra quem assistia.'
        ]
      },
      {
        kind: 'correcoes',
        items: [
          'Ao parar a sua transmissão com gente assistindo, o app não toca mais o som de "alguém saiu" antes do som de live encerrada. Esse som voltou a significar só o que ele diz: alguém escolheu sair da sua live.',
          'Ao parar a sua transmissão, a sala some de vez. Ela não volta mais pra lista alguns segundos depois, sem host, pra só então desaparecer.',
          'Quem estava assistindo é desconectado na hora em que a live acaba, em vez de ficar preso numa sala que não existe mais.',
          'Transmissões que ficavam "penduradas" na lista, sem ninguém transmitindo nelas, são removidas sozinhas.',
          'Uma live não aparece mais na lista sem foto e sem nome ("Live de ???"), ganhando essas informações dois ou três segundos depois. Ela só entra na lista quando a transmissão está de fato no ar — e aí já aparece completa.',
          'O tempo de duração da live passa a contar de quando a transmissão entra no ar, e não de quando você clica em iniciar. Antes ele já começava alguns segundos adiantado.',
          'Uma transmissão privada continua privada ao trocar a fonte no meio dela. Em algumas trocas ela voltava pública, e passava a aparecer na lista de todo mundo sem nenhum aviso.',
          'Trocar a fonte no meio da live também não reinicia mais o tempo de duração dela.',
          'O botão do chat em destaque (mensagem nova) não perde mais o destaque quando o cursor passa por cima dele.',
          'Assistindo a várias lives num monitor EM PÉ, elas não são mais cortadas em cima e embaixo: a partir de agora as lives encolhem juntas até caberem todas na área de exibição.'
        ]
      }
    ]
  },
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

// Compara duas versões "X.Y.Z" parte a parte, como número: negativo se
// `a` vem antes, positivo se vem depois, zero se são a mesma. Comparar
// como texto erraria a partir de dois dígitos ("1.10.0" < "1.9.0").
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => parseInt(part, 10) || 0)
  const pb = b.split('.').map((part) => parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// As versões que a pessoa ainda NÃO viu (2026-10-19, pedido do usuário):
// todas as que têm nota, acima da última que ela viu e até a instalada.
// Quem ficou três versões sem abrir o app recebe as três, e não só a
// última — é isso que a janela destaca.
//
// Sem "última vista" (primeira instalação, ou armazenamento apagado) só
// a instalada conta como nova: listar o histórico inteiro como novidade
// pra quem acabou de chegar seria mentira.
export function unseenReleases(lastSeen: string | null, installed: string): string[] {
  if (!lastSeen) return findRelease(installed) ? [installed] : []
  return RELEASE_NOTES.filter(
    (note) =>
      compareVersions(note.version, lastSeen) > 0 &&
      compareVersions(note.version, installed) <= 0
  ).map((note) => note.version)
}

// ---------------------------------------------------------------------
// Agrupamento por versão principal (2026-10-19, pedido do usuário)
// ---------------------------------------------------------------------
//
// SÓ a janela de notas agrupa: lá a 1.5.0 aparece como "1.5" e a 1.5.1
// entra como uma ATUALIZAÇÃO dentro dela, em vez de uma linha própria
// que empurraria a nota grande da versão pra baixo da lista. No resto do
// app (titlebar, login, diálogo de atualização) a versão continua
// aparecendo inteira, com os três números.
//
// A lista acima continua plana, uma entrada por versão publicada: é por
// ela que `findRelease` acha a versão instalada.

export interface ReleaseGroup {
  // "1.5" — os dois primeiros números.
  key: string
  // A nota da X.Y.0, a principal. `null` se a versão grande nunca teve
  // nota própria (só as atualizações) — a janela mostra só os cartões.
  base: ReleaseNote | null
  // As X.Y.Z com Z > 0, da mais nova pra mais antiga.
  patches: ReleaseNote[]
}

export function majorOf(version: string): string {
  return version.split('.').slice(0, 2).join('.')
}

export function isPatchVersion(version: string): boolean {
  return (parseInt(version.split('.')[2] ?? '0', 10) || 0) > 0
}

// Na ordem da lista (mais nova primeiro), um grupo por X.Y.
export function groupReleases(): ReleaseGroup[] {
  const groups: ReleaseGroup[] = []
  for (const note of RELEASE_NOTES) {
    const key = majorOf(note.version)
    let group = groups.find((item) => item.key === key)
    if (!group) {
      group = { key, base: null, patches: [] }
      groups.push(group)
    }
    if (isPatchVersion(note.version)) group.patches.push(note)
    else group.base = note
  }
  return groups
}
