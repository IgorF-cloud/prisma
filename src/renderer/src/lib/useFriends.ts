import { useCallback, useEffect, useMemo, useState } from 'react'

type FriendsSnapshot = Awaited<ReturnType<typeof window.api.users.friends>>

// O que eu sou de cada pessoa, do meu ponto de vista.
//   friend   = amigos (os dois lados aceitaram)
//   outgoing = EU pedi, e o outro ainda não respondeu
//   incoming = o outro me pediu
//   none     = nada entre nós
export type FriendRelation = 'friend' | 'outgoing' | 'incoming' | 'none'

export interface Friends {
  relationOf: (userId: number) => FriendRelation
  // Os amigos, pra quem precisa da lista inteira (a lista de amigos da
  // etapa 6). Um Set pelo mesmo motivo dos fixados no useUsersDirectory.
  friendIds: ReadonlySet<number>
  // Os pedidos, na ordem em que o servidor mandou — a aba "Pedidos" da
  // Lista de Amigos e o contador do botão da barra (etapa 6).
  incomingIds: readonly number[]
  outgoingIds: readonly number[]
  // As quatro ações. LANÇAM se o servidor recusar — quem chama avisa.
  request: (userId: number) => Promise<void>
  accept: (userId: number) => Promise<void>
  // Recusar, cancelar o pedido ou desfazer a amizade (a mesma rota).
  remove: (userId: number) => Promise<void>
}

const EMPTY: FriendsSnapshot = { friends: [], incoming: [], outgoing: [] }

// Amizades (2026-10-21, item 26 / etapa 5).
//
// O estado é o RETRATO que o servidor manda (ver friends.js lá): três
// listas de ids, sempre inteiras. Chega de três jeitos e todos fazem a
// mesma coisa — substituir o retrato:
//
//   - GET /friends ao montar (a mensagem do connect pode ter chegado
//     antes de este hook existir);
//   - `type: "friends"` pelo WebSocket, a cada mudança dos DOIS lados
//     (o outro aceitou, recusou, desfez);
//   - a resposta de cada ação minha, que já é o retrato depois dela.
//
// Sem update otimista: a resposta volta em milissegundos e já é o estado
// certo, e um pedido cruzado (os dois pedindo ao mesmo tempo) vira
// amizade no servidor — coisa que um palpite local não adivinharia.
//
// Vive na HomeScreen, como o useUsersDirectory, pra sobreviver a
// abrir/fechar os painéis.
export function useFriends(): Friends {
  const [snapshot, setSnapshot] = useState<FriendsSnapshot>(EMPTY)

  useEffect(() => {
    let cancelled = false
    // Servidor anterior às amizades responde 404: fica o retrato vazio,
    // e o menu simplesmente oferece "Adicionar amigo" (que vai falhar
    // com uma mensagem, que é o certo).
    window.api.users
      .friends()
      .then((next) => {
        if (!cancelled) setSnapshot(next)
      })
      .catch(() => {})
    const off = window.api.users.onFriends(setSnapshot)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const maps = useMemo(() => {
    const relation = new Map<number, FriendRelation>()
    for (const id of snapshot.incoming) relation.set(id, 'incoming')
    for (const id of snapshot.outgoing) relation.set(id, 'outgoing')
    for (const id of snapshot.friends) relation.set(id, 'friend')
    return { relation, friendIds: new Set(snapshot.friends) as ReadonlySet<number> }
  }, [snapshot])

  const relationOf = useCallback(
    (userId: number): FriendRelation => maps.relation.get(userId) ?? 'none',
    [maps]
  )

  const request = useCallback(async (userId: number) => {
    setSnapshot(await window.api.users.requestFriend(userId))
  }, [])
  const accept = useCallback(async (userId: number) => {
    setSnapshot(await window.api.users.acceptFriend(userId))
  }, [])
  const remove = useCallback(async (userId: number) => {
    setSnapshot(await window.api.users.removeFriend(userId))
  }, [])

  return {
    relationOf,
    friendIds: maps.friendIds,
    incomingIds: snapshot.incoming,
    outgoingIds: snapshot.outgoing,
    request,
    accept,
    remove
  }
}
