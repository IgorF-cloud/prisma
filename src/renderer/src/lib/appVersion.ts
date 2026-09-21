// Como a versão do app aparece pra quem usa (2026-09-10, pedido do
// usuário). UM lugar só, de propósito: a versão é mostrada em três
// telas diferentes, e "trocar o rótulo" viraria três edições fáceis de
// esquecer pela metade — que é exatamente como se lança uma 1.0.0
// escrita "BETA" numa tela e "v1.0.0" noutra.
//
// ---------------------------------------------------------------------
// ⚠️ ANTES DE LANÇAR A 1.0.0: trocar VERSION_LABEL por `null`.
// ---------------------------------------------------------------------
//
// A build de teste sai como "BETA" e o número fica escondido. Com
// `null`, todo mundo volta a mostrar `v1.0.0` sozinho. Está anotado
// também no item 17 do ROADMAP.md (o portão da release).
//
// O `package.json` continua em 1.0.0 e NÃO deve virar "BETA":
//
//   - não é semver válido, o electron-builder recusaria;
//   - o `isNewerVersion` (src/main/update.ts) faz `parseInt` em cada
//     parte da versão, e `parseInt('BETA') || 0` é 0 — a versão local
//     viraria [0,0,0] e o app se ofereceria pra "atualizar" pra
//     qualquer coisa publicada, em loop.
//
// O que muda aqui é só o que a pessoa LÊ.
//
// Anotado como `string | null` de propósito: sem a anotação o
// TypeScript estreita pro literal 'BETA', o `??` abaixo vira código
// morto, e trocar por `null` passaria a dar erro de tipo — justo na
// hora em que se quer que seja uma edição de um caractere.
export const VERSION_LABEL: string | null = 'BETA'

// Recebe o que `app.getVersion()` devolveu e entrega o texto que vai na
// tela.
//
// ⚠️ MUDOU em 2026-09-17 (pedido do usuário): antes isto devolvia o
// VERSION_LABEL NO LUGAR do número — a titlebar dizia só "BETA" e a
// versão instalada não aparecia em canto nenhum do app. Na hora em que
// alguém relata um problema, "qual versão você está usando?" não tinha
// resposta sem abrir o instalador.
//
// Agora o número sai sempre, e o rótulo do canal virou um chip AO LADO
// dele, renderizado por quem exibe. São dois dados diferentes — o que a
// build é (BETA) e qual build é (v1.0.4) — e um não substitui o outro.
export function formatAppVersion(version: string): string {
  return `v${version}`
}
