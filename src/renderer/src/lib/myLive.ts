import { RoomInfo, roomSources } from './useRooms'

// ONDE A MINHA LIVE ESTÁ NO AR (2026-10-28, item 27 — uma live por
// pessoa). O mesmo myLive.ts do Prisma Web, do ponto de vista do app:
//
//   here     neste app
//   web      no Prisma Web (o site)
//   app      em OUTRO app (a mesma conta aberta em outro computador)
//   unknown  no ar, mas o servidor não disse de onde (servidor antigo)
export type MyLiveWhere = 'here' | 'web' | 'app' | 'unknown'

// `ownCode` é a sala que ESTE app transmite (ou acabou de transmitir e
// ainda não sumiu da lista), que não conta como "outro lugar". Só sala com
// alguma transmissão no ar: parar manda o servidor tirar a transmissão do
// anúncio na hora, e uma sala que ainda não sumiu da lista não pode travar
// o botão.
export function myLiveWhere(
  rooms: RoomInfo[],
  myName: string,
  transmittingHere: boolean,
  ownCode: string | null
): MyLiveWhere | null {
  if (transmittingHere) return 'here'
  for (const room of rooms) {
    if (room.hostName !== myName || room.name === ownCode) continue
    const sources = roomSources(room)
    if (!sources.screen && !sources.cam) continue
    const origin = (sources.screen ? room.origins?.screen : null) ?? room.origins?.cam ?? null
    return origin ?? 'unknown'
  }
  return null
}

// A tag do cabeçalho do perfil (pedido do usuário: "Transmitindo do Site
// ou App").
export function myLiveTagLabel(where: MyLiveWhere): string {
  if (where === 'web') return 'Transmitindo do Site'
  if (where === 'unknown') return 'Transmitindo'
  return 'Transmitindo do App'
}

// O motivo no hover do botão de transmitir travado.
export function liveElsewhereReason(where: MyLiveWhere): string {
  if (where === 'web') return 'Já transmitindo pelo Site'
  if (where === 'app') return 'Já transmitindo pelo App em outro computador'
  return 'Você já está transmitindo'
}
