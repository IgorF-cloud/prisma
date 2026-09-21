import { useCallback, useEffect, useRef, useState } from 'react'

// Quanto tempo esperar por uma resposta antes de destravar o botão
// sozinho.
//
// O toast do convidado expira em 30s (INVITE_TIMEOUT_MS no
// InviteToast.tsx) e ele mesmo avisa o servidor quando isso acontece —
// então, no caminho normal, esta rede de segurança nunca é usada.
//
// Ela existe pros caminhos em que o aviso não vem: o app do convidado
// fechou, caiu a internet dele, ou o WebSocket daqui reconectou e perdeu
// a mensagem no meio. Sem isto, um botão ficaria travado até a pessoa
// fechar o painel — um estado morto que ninguém consegue desfazer.
//
// 40s = os 30 do convite + folga pra ida e volta.
const RESULT_TIMEOUT_MS = 40_000

export interface InviteTracking {
  // Ids de quem tem um convite NO AR: mandei e ainda não sei o desfecho.
  pending: Set<number>
  markInvited: (userId: number) => void
}

// Rastreia os convites da MINHA live (2026-09-14, pedido do usuário).
//
// Antes o app marcava "convidado" e pronto: se a pessoa recusasse, o
// botão continuava travado pra sempre e quem convidou nunca ficava
// sabendo de nada. Agora o servidor avisa o desfecho (ver
// `notifyInviteResult` no server.js) e este hook traduz isso em duas
// coisas: destravar o botão e um aviso na tela.
//
// ---------------------------------------------------------------------
// O QUE ESTE HOOK **NÃO** GUARDA
//
// "Já está na minha live" não é estado daqui, e é de propósito: isso se
// lê da lista de quem está assistindo, que já chega em tempo real. Um
// "aceitou" guardado aqui teria que ser apagado quando a pessoa saísse da
// sala — e enquanto não fosse, o host não conseguiria convidar de novo
// alguém que entrou e saiu.
//
// Por isso `accepted` só faz uma coisa aqui: encerrar a pendência. Quem
// decide o botão a partir dali é a lista de viewers (ver UsersSidebar).
// ---------------------------------------------------------------------
//
// Vive na HomeScreen e não no UsersSidebar porque o painel é montado e
// desmontado a cada abrir/fechar, e o resultado de um convite pode
// chegar com ele fechado — ali dentro, o "recusou" se perderia.
export function useInviteTracking(
  // Código da live no ar, ou null. Trocar de live zera tudo: convite é
  // por SALA, e o que foi mandado na live anterior não vale nesta.
  myRoomCode: string | null,
  onNotify: (message: string, isError?: boolean) => void
): InviteTracking {
  const [pending, setPending] = useState<Set<number>>(new Set())

  // `onNotify` chega como uma arrow function criada no render do App, ou
  // seja, com identidade nova toda vez. Guardado num ref, a inscrição no
  // evento do main depende só da sala — senão ela seria desfeita e
  // refeita a cada render desta tela, que re-renderiza a cada broadcast
  // de salas (isto é, o tempo todo durante uma live).
  //
  // Atualizado dentro de um efeito, e não no corpo do hook: escrever num
  // ref durante o render é proibido pelas regras do React (o render tem
  // que ser puro) e o ESLint barra.
  const notifyRef = useRef(onNotify)
  useEffect(() => {
    notifyRef.current = onNotify
  }, [onNotify])

  // Os timers de segurança, por usuário. Em ref e não em estado: mudar um
  // timer não muda nada na tela.
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const clearTimer = useCallback((userId: number) => {
    const timer = timersRef.current.get(userId)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(userId)
    }
  }, [])

  const forget = useCallback(
    (userId: number) => {
      clearTimer(userId)
      setPending((current) => {
        if (!current.has(userId)) return current
        const next = new Set(current)
        next.delete(userId)
        return next
      })
    },
    [clearTimer]
  )

  const markInvited = useCallback(
    (userId: number) => {
      clearTimer(userId)
      setPending((current) => new Set(current).add(userId))
      timersRef.current.set(
        userId,
        setTimeout(() => forget(userId), RESULT_TIMEOUT_MS)
      )
    },
    [clearTimer, forget]
  )

  // Live nova (ou live encerrada): esquece tudo.
  useEffect(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(new Set())
  }, [myRoomCode])

  // Limpa os timers se a tela sair do ar com convites pendentes.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  useEffect(() => {
    return window.api.users.onInviteResult(({ roomName, userId, userName, result }) => {
      // Resposta de um convite de OUTRA live (a anterior, que já acabou)
      // não pode mexer no estado desta.
      if (roomName !== myRoomCode) return

      forget(userId)

      // Aceitou: nada a avisar. A pessoa aparecendo na lista de quem está
      // assistindo já conta a história, e um aviso por cima seria o mesmo
      // fato duas vezes.
      if (result === 'accepted') return

      notifyRef.current(
        result === 'expired'
          ? `${userName} não respondeu ao convite`
          : `${userName} recusou o convite`
      )
    })
  }, [myRoomCode, forget])

  return { pending, markInvited }
}
