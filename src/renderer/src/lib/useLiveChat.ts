import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from './errors'

// Chat temporário da live (2026-09-23) — item novo do ROADMAP.
//
// A mensagem não passa pelo LiveKit. Ela sobe por HTTP e desce pelo
// WebSocket de salas que já existe (ver src/main/chat.ts e
// src/main/rooms.ts), exatamente como o convite já funciona. O motivo é
// o HOST: ele publica via GStreamer/WHIP, então quem representa ele no
// LiveKit é o Ingress, que só carrega mídia — o app dele não tem conexão
// de dados nenhuma com a própria sala (só abre uma `Room` quando o
// preview é ligado, ver useHostPreview.ts). Pelo data channel do
// LiveKit, o chat exigiria uma conexão nova e permanente no host, que é
// exatamente a classe de bug que o `NEVER_RECONNECT` de lá existe pra
// conter (conexão sobrevivente ressuscitando sala apagada).
//
// ESTADO POR SALA, e não um chat só: pelo item 23 do roadmap dá pra
// assistir várias lives ao mesmo tempo, então são N chats simultâneos —
// e o host ainda tem o da própria live por cima disso.
//
// `openRoom`/`closeRoom` em vez de um efeito sincronizando com uma lista
// de salas: é o mesmo desenho do useViewer.ts, onde quem mexe no estado
// é sempre uma ação (entrar/sair da sala), nunca um efeito reagindo a
// prop. Chamados dos mesmos lugares que já chamam `viewer.joinRoom` /
// `viewer.leaveRoom` e o start/stop da transmissão.
//
// NADA persiste. O servidor guarda as últimas mensagens em memória e
// apaga tudo quando a sala acaba (ver forgetRoom em presence.js); aqui o
// balde da sala é descartado no `closeRoom`.

export interface ChatMessage {
  id: string
  from: string
  text: string
  at: number
}

export interface ChatRoomState {
  messages: ChatMessage[]
  // Quem o host silenciou nesta sala, por NOME. Vem pra todo mundo, e
  // não só pro host (2026-09-23): o selo de silenciado aparece na lista
  // de espectadores das DUAS telas.
  //
  // Por nome, e não por id, porque é assim que toda lista do app fala
  // (a identity do LiveKit). No servidor a chave continua sendo o id,
  // que é o que sobrevive a uma renomeação — ver mutedInRoom em
  // presence.js.
  //
  // "EU estou silenciado?" sai daqui também, com um `has(meuNome)` —
  // um estado a menos pra manter em sincronia.
  mutedNames: Set<string>
  // Histórico ainda chegando. Serve pra UI não piscar "nenhuma mensagem"
  // antes da resposta.
  loading: boolean
  // Quantas chegaram desde o último `markRead` — é o badge da aba
  // fechada. Nunca conta as minhas próprias mensagens: o eco do servidor
  // traz de volta o que eu mesmo acabei de mandar, e um contador de não
  // lidas subindo porque EU falei seria só errado.
  unread: number
}

interface UseLiveChatResult {
  rooms: Record<string, ChatRoomState>
  // As salas que têm chat AGORA: as que estou assistindo, mais a minha
  // quando estou transmitindo. Abre as que entraram, fecha as que
  // saíram. Idempotente — chamar com a mesma lista não faz nada.
  //
  // Uma função só (em vez de `openRoom`/`closeRoom` soltos) porque ela
  // decide o que fechar pela própria ref interna: assim quem chama não
  // precisa ler `rooms` pra saber o que está aberto, o que colocaria o
  // estado do chat nas dependências do efeito e o faria rodar de novo a
  // cada mensagem que chega.
  syncRooms: (roomCodes: string[]) => void
  // Zera o contador de não lidas — chamado quando o chat da sala fica
  // VISÍVEL (a aba abriu), não quando a mensagem chega.
  markRead: (roomCode: string) => void
  send: (roomCode: string, text: string) => Promise<boolean>
  setMuted: (roomCode: string, username: string, muted: boolean) => Promise<boolean>
}

const EMPTY_ROOM: ChatRoomState = {
  messages: [],
  mutedNames: new Set(),
  loading: true,
  unread: 0
}

// `onError` é pros erros de ENVIO (silenciado, rápido demais, caiu a
// rede). O pedido do histórico falha em silêncio de propósito: um chat
// que abre vazio é bem menos ruim que um snackbar de erro toda vez que
// alguém entra numa sala que acabou de morrer.
// `selfName`: quem eu sou, pro contador de não lidas ignorar as minhas
// próprias mensagens (elas voltam pelo eco do servidor como todas as
// outras). null antes do login.
export function useLiveChat(
  selfName: string | null,
  onError?: (message: string) => void
): UseLiveChatResult {
  const [rooms, setRooms] = useState<Record<string, ChatRoomState>>({})

  // Em ref pelo mesmo motivo do `openRoomsRef`: o listener de mensagens
  // é registrado uma vez só, no mount, e precisa enxergar o nome atual
  // sem ser reassinado quando ele muda (renomear no meio da live).
  const selfNameRef = useRef(selfName)
  // Num efeito, e não direto no corpo: escrever numa ref durante o
  // render é proibido pela regra do projeto (e pelo React Compiler).
  useEffect(() => {
    selfNameRef.current = selfName
  }, [selfName])

  // Quais salas estão abertas, pro listener do WebSocket saber o que
  // aceitar. Em ref (e não lendo `rooms` direto) pra o listener ser
  // registrado UMA vez, no mount: reassinar a cada sala aberta/fechada
  // arriscaria perder uma mensagem na janela entre desinscrever e
  // inscrever de novo.
  const openRoomsRef = useRef<Set<string>>(new Set())

  const openRoom = useCallback((roomCode: string) => {
    // Já aberta (ex: o efeito da tela remontou) — não refaz o GET nem
    // joga fora o que já chegou.
    if (openRoomsRef.current.has(roomCode)) return
    openRoomsRef.current.add(roomCode)
    setRooms((current) => ({ ...current, [roomCode]: EMPTY_ROOM }))

    window.api.chat
      .history(roomCode)
      .then(({ messages, mutedNames }) => {
        // Saiu da sala enquanto o histórico vinha.
        if (!openRoomsRef.current.has(roomCode)) return
        setRooms((current) => {
          // Chegou mensagem pelo WebSocket enquanto o histórico vinha?
          // Ela fica: o histórico é a BASE, e o que já chegou vai depois
          // dele, sem repetir o que a resposta já trouxe.
          const arrived = current[roomCode]?.messages ?? []
          const known = new Set(messages.map((m) => m.id))
          return {
            ...current,
            [roomCode]: {
              messages: [...messages, ...arrived.filter((m) => !known.has(m.id))],
              mutedNames: new Set(mutedNames),
              loading: false,
              // O historico NAO conta como nao-lido: sao mensagens de
              // antes de eu chegar, e o badge existe pro que acontece
              // enquanto a aba esta fechada. So o que chega depois conta.
              unread: current[roomCode]?.unread ?? 0
            }
          }
        })
      })
      .catch((err) => {
        // Em silêncio de propósito (ver o comentário do `onError`).
        console.warn(`[chat] não deu pra carregar o histórico da sala ${roomCode}:`, err)
        if (!openRoomsRef.current.has(roomCode)) return
        setRooms((current) =>
          current[roomCode]
            ? { ...current, [roomCode]: { ...current[roomCode], loading: false } }
            : current
        )
      })
  }, [])

  const closeRoom = useCallback((roomCode: string) => {
    openRoomsRef.current.delete(roomCode)
    setRooms((current) => {
      if (!current[roomCode]) return current
      const next = { ...current }
      delete next[roomCode]
      return next
    })
  }, [])

  // Chamado quando o chat da sala fica visível. Não zera nada quando já
  // está em zero — devolver o mesmo objeto evita um render à toa a cada
  // abertura.
  const markRead = useCallback((roomCode: string) => {
    setRooms((current) => {
      const room = current[roomCode]
      if (!room || room.unread === 0) return current
      return { ...current, [roomCode]: { ...room, unread: 0 } }
    })
  }, [])

  const syncRooms = useCallback(
    (roomCodes: string[]) => {
      const wanted = new Set(roomCodes)
      // Cópia antes de iterar: o closeRoom abaixo apaga do mesmo Set.
      for (const code of [...openRoomsRef.current]) {
        if (!wanted.has(code)) closeRoom(code)
      }
      for (const code of roomCodes) openRoom(code)
    },
    [openRoom, closeRoom]
  )

  // Listener único, registrado no mount. Mensagem de sala que não está
  // aberta é descartada — pode chegar no intervalo entre sair da sala e
  // o servidor parar de mandar.
  useEffect(() => {
    const offMessage = window.api.chat.onMessage(({ roomName, message }) => {
      if (!openRoomsRef.current.has(roomName)) return
      // Mensagem de outra pessoa numa sala que eu assisto ou na minha
      // (etapa 8, 2026-10-22): o laranja na barra de tarefas. O main só
      // acende com o app sem foco — ver taskbarFlash.ts.
      if (message.from !== selfNameRef.current) window.api.app.flashTaskbar()
      setRooms((current) => {
        const room = current[roomName] ?? EMPTY_ROOM
        // O servidor ecoa a mensagem pro próprio autor, então esta é a
        // ÚNICA via pela qual uma mensagem entra na tela — não existe
        // update otimista pra conciliar. A checagem de id é só contra
        // duplicata de corrida com o histórico.
        if (room.messages.some((m) => m.id === message.id)) return current
        return {
          ...current,
          [roomName]: {
            ...room,
            messages: [...room.messages, message],
            unread: message.from === selfNameRef.current ? room.unread : room.unread + 1
          }
        }
      })
    })

    // Alguém foi silenciado (ou liberado) nesta sala. Chega pra TODO
    // MUNDO que está nela, não só pra pessoa em questão — é o que faz o
    // selo aparecer/sumir na lista de espectadores de todos na hora, sem
    // ninguém precisar recarregar nada.
    const offMuted = window.api.chat.onMuted(({ roomName, username, muted }) => {
      if (!openRoomsRef.current.has(roomName)) return
      setRooms((current) => {
        const room = current[roomName]
        if (!room) return current
        const mutedNames = new Set(room.mutedNames)
        if (muted) mutedNames.add(username)
        else mutedNames.delete(username)
        return { ...current, [roomName]: { ...room, mutedNames } }
      })
    })

    return () => {
      offMessage()
      offMuted()
    }
  }, [])

  // `false` quando não deu — o erro já foi pro `onError`. Quem chama usa
  // isso pra decidir se limpa o campo de texto (não limpar quando falhou
  // evita perder o que a pessoa escreveu).
  const send = useCallback(
    async (roomCode: string, text: string): Promise<boolean> => {
      const trimmed = text.trim()
      if (!trimmed) return false
      try {
        await window.api.chat.send(roomCode, trimmed)
        return true
      } catch (err) {
        onError?.(getErrorMessage(err, 'Não foi possível enviar a mensagem'))
        return false
      }
    },
    [onError]
  )

  // Silenciar/liberar alguém na MINHA live. O servidor recusa com 403
  // quem não for o host, então isto não depende da UI esconder o botão.
  //
  // Não mexe em estado nenhum aqui: o servidor avisa a sala inteira pelo
  // WebSocket (inclusive quem pediu) e o listener acima aplica — mesmo
  // desenho do envio de mensagem, com uma fonte de verdade só.
  const setMuted = useCallback(
    async (roomCode: string, username: string, muted: boolean): Promise<boolean> => {
      try {
        await window.api.chat.mute(roomCode, username, muted)
        // Nada de estado aqui. O servidor avisa a sala inteira pelo
        // WebSocket (inclusive quem pediu), e o listener acima aplica —
        // o mesmo desenho do envio de mensagem, com uma fonte de verdade
        // só. Antes isto relia o histórico inteiro só pra atualizar a
        // lista de silenciados; com o aviso chegando pra todos, essa
        // segunda chamada virou desperdício.
        return true
      } catch (err) {
        onError?.(getErrorMessage(err, 'Não foi possível silenciar este usuário'))
        return false
      }
    },
    [onError]
  )

  return { rooms, syncRooms, markRead, send, setMuted }
}
