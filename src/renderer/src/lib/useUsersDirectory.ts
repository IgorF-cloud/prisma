import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from './errors'
import { PresenceMap } from './useRooms'

type DirectoryUser = Awaited<ReturnType<typeof window.api.users.list>>['users'][number]

export interface UsersDirectory {
  users: DirectoryUser[]
  // Só é `true` na PRIMEIRA carga, quando ainda não há nada pra mostrar.
  // Uma revalidação em segundo plano NÃO volta pra cá — senão a lista
  // piscaria "Carregando..." por cima de dados perfeitamente bons.
  loading: boolean
  error: string | null
  refresh: () => void
  // Os ids que EU fixei (2026-09-25). Um Set e não um array: a lista
  // pergunta "este está fixado?" uma vez por tile a cada render, e num
  // array isso seria uma varredura por pessoa.
  pinned: ReadonlySet<number>
  // Fixa ou desfixa, já atualizando a tela antes da resposta do
  // servidor. LANÇA se a chamada falhar — e nesse caso a tela já voltou
  // sozinha ao que era; quem chama só precisa avisar o usuário.
  setPinned: (id: number, next: boolean) => Promise<void>
}

// Diretório de contas do app (2026-09-11).
//
// Nasceu de um sintoma que o usuário notou: a lista demorava um instante
// pra aparecer a cada clique. A causa era estrutural — o `UsersSidebar`
// era montado condicionalmente (`{aberto && <Sidebar/>}`), então FECHAR o
// painel destruía o componente e ABRIR criava um novo, que disparava um
// `GET /users` do zero. O botão não "mostrava" a lista, ele a
// reconstruía.
//
// A correção é tirar os dados de dentro do componente: este hook vive na
// HomeScreen, carrega uma vez e sobrevive a abrir/fechar. O painel virou
// só apresentação e renderiza instantaneamente.
//
// Não recebe um `enabled`: a HomeScreen só existe depois do login, então
// quando este hook roda já há token. Um parâmetro pra desligar exigiria
// um `setUsers([])` síncrono dentro do efeito, que é justamente o que a
// regra `react-hooks` proíbe (renders em cascata).
//
// `presence` entrou em 2026-09-20, por um sintoma do usuário: alguém
// criava uma conta e a lista de quem já estava logado continuava sem a
// pessoa até reiniciar o app. A lista de CONTAS realmente muda raramente,
// e é por isso que ela não tem um canal em tempo real só dela — mas o
// mapa de presença, que já chega sozinho pelo WebSocket, é um aviso de
// graça: um id que aparece ali e não existe no diretório só pode ser uma
// conta criada depois da última busca. Aí vale a pena buscar de novo.
// Não é o servidor anunciando "nasceu um usuário" (isso exigiria uma
// mensagem nova lá); é este lado reparando que há um id que ele não
// conhece.
export function useUsersDirectory(presence: PresenceMap): UsersDirectory {
  const [users, setUsers] = useState<DirectoryUser[]>([])
  // Começa `true` e só vira `false` no `finally` — nunca é religado.
  // É isso que dá o stale-while-revalidate de graça: a primeira carga
  // mostra "Carregando...", e toda revalidação posterior acontece em
  // silêncio, com os dados antigos na tela.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Muda pra disparar o efeito de novo. Um contador em vez de chamar o
  // fetch direto no `refresh`: assim a proteção contra corrida (o
  // `cancelled` abaixo) vale pra TODA busca, inclusive as manuais.
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => setReloadToken((n) => n + 1), [])

  // Quem eu fixei. Vem na mesma resposta do `GET /users` (ver o
  // `pinned` do preload) — é por isso que não há um segundo estado de
  // carregamento aqui: quando a lista aparece, a ordem dela já está
  // certa. Buscar em separado faria os fixados "pularem" pro topo um
  // instante depois de a lista desenhar.
  const [pinned, setPinnedState] = useState<ReadonlySet<number>>(() => new Set())

  // Otimista: a tela muda no clique e o servidor confirma depois.
  //
  // Vale a pena porque o efeito visível é uma REORDENAÇÃO — esperar a
  // ida e volta deixaria o tile parado sob o cursor por um instante
  // depois de o usuário mandar ele subir, que é exatamente o tipo de
  // atraso que faz um botão parecer quebrado.
  //
  // E o risco é baixo: as duas rotas são idempotentes, então nada se
  // perde se a chamada for repetida. Dando errado, o `catch` devolve o
  // estado anterior e relança pra quem chamou mostrar o erro.
  const setPinned = useCallback(async (id: number, next: boolean): Promise<void> => {
    setPinnedState((current) => {
      const updated = new Set(current)
      if (next) updated.add(id)
      else updated.delete(id)
      return updated
    })

    try {
      if (next) await window.api.users.pin(id)
      else await window.api.users.unpin(id)
    } catch (err) {
      setPinnedState((current) => {
        const reverted = new Set(current)
        // Desfaz o que ESTE clique fez, e só isso: reaproveitar um
        // retrato do estado anterior sobrescreveria um segundo clique,
        // em outra pessoa, que tenha acontecido durante a espera.
        if (next) reverted.delete(id)
        else reverted.add(id)
        return reverted
      })
      throw err
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    window.api.users
      .list()
      .then((result) => {
        if (cancelled) return
        setUsers(result.users)
        setPinnedState(new Set(result.pinned))
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(getErrorMessage(err, 'Não foi possível carregar os usuários'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  // Ids que já provocaram uma rebusca. Sem esta memória, um id que o
  // `GET /users` não devolve (uma conta banida que ainda consta online,
  // por exemplo) faria uma busca nova a CADA broadcast de salas, pra
  // sempre. Aqui cada id desconhecido custa no máximo uma tentativa.
  const retriedIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    // Durante a primeira carga não dá pra saber quem é desconhecido: a
    // lista ainda está vazia e TODO mundo online pareceria novo.
    if (loading) return

    const known = new Set(users.map((account) => account.id))
    const unseen = Object.keys(presence)
      .map(Number)
      .filter((id) => !known.has(id) && !retriedIdsRef.current.has(id))
    if (unseen.length === 0) return

    for (const id of unseen) retriedIdsRef.current.add(id)
    refresh()
  }, [presence, users, loading, refresh])

  return { users, loading, error, refresh, pinned, setPinned }
}
