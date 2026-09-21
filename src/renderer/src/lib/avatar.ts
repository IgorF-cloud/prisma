// Roadmap item 43: avatar de usuário. Hoje só existe UM tipo que
// desenha alguma coisa — a foto customizada (upload comprimido pelo
// próprio cliente). `id`/`version` vêm do server
// (buildUserAvatarsDirectory em server.js) e servem só pra montar a
// URL; `version` é o cache-buster.
//
// Os PRESETS (cor escolhida a dedo + ícone genérico) foram removidos
// em 2026-09-11: a escolha manual já tinha saído da UI no item 43, e
// manter as cores vivas fazia duas contas SEM FOTO aparecerem
// diferentes uma da outra. Agora quem não tem foto tem exatamente o
// mesmo placeholder cinza (ver UserAvatar.tsx).
//
// O braço 'preset' do tipo CONTINUA aqui de propósito, e não é
// resquício: contas criadas antes disso ainda têm
// `{"type":"preset",...}` gravado no banco, e o servidor devolve o
// que está lá. Tirar o braço faria o TypeScript prometer que isso não
// chega — mentira que só apareceria em produção. O código trata
// qualquer coisa que não seja 'custom' como "sem foto", então o dado
// antigo é inofensivo.
export type AvatarRef =
  { type: 'preset'; key: string } | { type: 'custom'; id: number; version: number }

// Monta a URL de uma foto customizada — `?v=` é só cache-buster (sem
// isso, um <img> já teria cacheado a foto antiga do mesmo id e não
// atualizaria sozinho depois de trocar).
export function customAvatarUrl(
  apiBaseUrl: string,
  avatar: { id: number; version: number }
): string {
  return `${apiBaseUrl}/avatars/${avatar.id}.webp?v=${avatar.version}`
}

const AVATAR_UPLOAD_SIZE = 96

// Comprime a imagem escolhida (jpg/jpeg/png) pra WebP 96x96 direto no
// cliente (decisão confirmada com o usuário, 2026-09-01: evita depender
// de uma lib nativa tipo `sharp` no servidor). `createImageBitmap` decodifica
// qualquer formato de imagem suportado pelo Chromium sem precisar de
// <img> intermediário; o canvas então recorta um quadrado central
// (cover, não stretch) antes de reduzir pro tamanho final.
export async function compressImageToAvatarWebp(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file)

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_UPLOAD_SIZE
  canvas.height = AVATAR_UPLOAD_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível processar a imagem.')

  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_UPLOAD_SIZE, AVATAR_UPLOAD_SIZE)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9)
  )
  if (!blob) throw new Error('Não foi possível comprimir a imagem.')

  return new Uint8Array(await blob.arrayBuffer())
}
