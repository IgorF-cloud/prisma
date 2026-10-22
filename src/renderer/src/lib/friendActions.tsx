import { createContext, useContext } from 'react'
import { getErrorMessage } from './errors'
import { Friends } from './useFriends'
import { NowPlayingInfo } from './nowPlaying'

type Notify = (message: string, isError?: boolean) => void

// Alguém com quem dá pra ter (ou não) uma amizade — só o que as ações
// precisam: o id pra rota, o nome pras mensagens.
export interface FriendTarget {
  id: number
  name: string
}

// Uma ação de amizade, com o aviso de cada desfecho (2026-10-21). Os
// avisos de sucesso existem porque o resultado nem sempre aparece onde se
// clicou: quem recebe o pedido é a outra pessoa.
export async function runFriendAction(
  action: (id: number) => Promise<void>,
  target: FriendTarget,
  notify: Notify,
  success: string | null,
  failure: string
): Promise<void> {
  try {
    await action(target.id)
    if (success) notify(success)
  } catch (err) {
    notify(getErrorMessage(err, failure), true)
  }
}

export const friendActions = {
  request: (friends: Friends, target: FriendTarget, notify: Notify) =>
    runFriendAction(
      friends.request,
      target,
      notify,
      `Pedido de amizade enviado para ${target.name}`,
      'Não foi possível enviar o pedido'
    ),
  accept: (friends: Friends, target: FriendTarget, notify: Notify) =>
    runFriendAction(
      friends.accept,
      target,
      notify,
      `Você e ${target.name} agora são amigos`,
      'Não foi possível aceitar o pedido'
    ),
  decline: (friends: Friends, target: FriendTarget, notify: Notify) =>
    runFriendAction(friends.remove, target, notify, null, 'Não foi possível recusar o pedido'),
  cancel: (friends: Friends, target: FriendTarget, notify: Notify) =>
    runFriendAction(friends.remove, target, notify, null, 'Não foi possível cancelar o pedido'),
  unfriend: (friends: Friends, target: FriendTarget, notify: Notify) =>
    runFriendAction(
      friends.remove,
      target,
      notify,
      `Você e ${target.name} não são mais amigos`,
      'Não foi possível desfazer a amizade'
    )
}

// O que o CARD de perfil (UserCardPopover) precisa pra oferecer a
// amizade, de qualquer lugar onde ele abre — a Lista de Amigos, os
// Membros, a lista de quem assiste uma sala, a da minha live. Um contexto
// e não props porque são quatro caminhos até o card, e o card só conhece
// o NOME (as listas de quem assiste são de nomes): o id sai do diretório.
export interface FriendsContextValue {
  friends: Friends
  idByName: (name: string) => number | null
  selfId: number
  notify: Notify
  // O MINI PERFIL (2026-10-21) também fixa e mostra a live da pessoa —
  // as ações que eram do menu "Mais" das listas foram todas pra ele.
  pinned: ReadonlySet<number>
  // LANÇA se o servidor recusar (a tela já voltou sozinha).
  togglePin: (id: number, next: boolean) => Promise<void>
  // A sala que essa pessoa está transmitindo agora, ou null.
  roomOfHost: (name: string) => CardLiveRoom | null
  // Abre os detalhes de uma sala (o mesmo painel do tile da barra).
  openRoom: (code: string) => void
}

export interface CardLiveRoom {
  code: string
  game: NowPlayingInfo | null
  viewers: number
}

export const FriendsContext = createContext<FriendsContextValue | null>(null)

export function useFriendsContext(): FriendsContextValue | null {
  return useContext(FriendsContext)
}
