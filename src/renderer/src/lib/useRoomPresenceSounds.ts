import { useEffect, useRef } from 'react'
import { RoomInfo } from './useRooms'
import { playSound } from './sounds'

// Roadmap item 35: toca um som quando alguém entra (newViewer) ou sai
// (viewerOut) da MINHA transmissão.
//
// Reduzido a pedido do usuário (2026-09-06): antes valia pra qualquer
// sala "de interesse" — a minha E todas que eu estivesse assistindo —,
// então eu ouvia entrada/saída de gente na live dos outros também. Agora
// é só a minha própria live, como HOST. Numa sala que eu só assisto, a
// movimentação de viewers ficou silenciosa de propósito.
//
// A sala inteira sumindo (host parou a live) não passa por aqui: é outro
// evento, tratado em useViewer.ts (som 'stopLive'). Como host, quem toca
// o 'stopLive' é o próprio useGstreamerTransmission.
export function useRoomPresenceSounds(
  rooms: RoomInfo[],
  myRoomCode: string | null,
  myName: string
): void {
  // Identities já vistas na minha sala, sem me contar (o host não precisa
  // de som pra própria presença). `null` = ainda não observei nada — a
  // primeira observação só grava a baseline, SEM tocar som: sem isso,
  // quem já estava lá quando a live começou tocaria "entrou" em lote.
  //
  // Guarda junto de QUAL sala é essa baseline: sem isso, ir de uma sala
  // direto pra outra (sem passar por `null` no meio) compararia a lista
  // de participantes da sala nova contra a baseline da anterior —
  // tocando "entrou"/"saiu" pra todo mundo de uma vez. Hoje parar a live
  // sempre passa por `null`, mas depender dessa ordem é frágil demais
  // pra um efeito que só existe pra evitar exatamente esse tipo de
  // disparo em lote.
  const knownRef = useRef<{ roomCode: string; ids: Set<string> } | null>(null)

  useEffect(() => {
    // Sem live minha no ar: zera a baseline. Sem isso, ao transmitir de
    // novo depois, o diff seria contra um estado de horas atrás (ex:
    // "todo mundo saiu" de uma vez, ou "entrou" pra quem já tinha ido).
    if (!myRoomCode) {
      knownRef.current = null
      return
    }

    const room = rooms.find((r) => r.name === myRoomCode)

    // A sala ainda não apareceu na lista (corrida entre iniciar a
    // transmissão e o servidor registrar a sala) — sai sem gravar
    // baseline, senão a primeira baseline seria "vazia" e todo mundo que
    // já estivesse dentro tocaria "entrou" no tick seguinte.
    if (!room) return

    const currentIds = new Set(room.participants.filter((id) => id !== myName))
    // Só compara contra uma baseline da MESMA sala (ver acima).
    const anterior = knownRef.current
    const previousIds = anterior?.roomCode === myRoomCode ? anterior.ids : null

    if (previousIds) {
      let joined = false
      let left = false
      for (const id of currentIds) {
        if (!previousIds.has(id)) joined = true
      }
      for (const id of previousIds) {
        if (!currentIds.has(id)) left = true
      }
      if (joined) playSound('newViewer')
      if (left) playSound('viewerOut')
    }

    knownRef.current = { roomCode: myRoomCode, ids: currentIds }
  }, [rooms, myRoomCode, myName])
}
