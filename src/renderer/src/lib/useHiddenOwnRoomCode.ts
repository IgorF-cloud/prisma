import { useEffect, useRef, useState } from 'react'
import { RoomInfo } from './useRooms'

// Roadmap item 38 — enquanto a MINHA transmissão está no ar (item 18), a
// própria sala não deve aparecer na lista de salas pra mim mesmo. O
// código já tentava fazer isso comparando contra `roomCode` (estado da
// transmissão, ver useGstreamerTransmission.ts) — só que `roomCode` zera
// assim que os DOIS `DELETE` (ingress + sala) confirmam sucesso NO
// LIVEKIT, o que NÃO é o mesmo instante em que o webhook `room_finished`
// chega no token-server e propaga pro `rooms:update` que a Home também
// escuta (ver server.js). Nesse intervalo — às vezes rápido, às vezes
// alguns segundos — a própria sala reaparecia sozinha na lista até o
// próximo push do WebSocket.
//
// Esse hook desacopla a "supressão" da sidebar do estado de transmissão
// em si: guarda o código da MINHA sala assim que uma transmissão começa,
// e só solta a supressão quando a sala realmente SOME da lista `rooms`
// em tempo real — a fonte de verdade de "a sala morreu de verdade" é a
// lista em si, não as chamadas REST de DELETE (que só disparam a
// intenção, sem garantia de quando o resto do sistema já sabe disso).
export function useHiddenOwnRoomCode(
  startedRoomCode: string | null,
  rooms: RoomInfo[]
): string | null {
  const [hiddenCode, setHiddenCode] = useState<string | null>(null)
  // Espelha `hiddenCode` numa ref só pra ler o valor mais recente dentro
  // do efeito de baixo sem precisar listar `hiddenCode` nas deps (evita
  // um efeito extra rodando toda vez que ele muda, sem ganho nenhum).
  const hiddenCodeRef = useRef<string | null>(null)
  // A sala suprimida JÁ CHEGOU a aparecer na lista?
  //
  // BUG REAL corrigido em 2026-09-13. O efeito abaixo soltava a
  // supressão assim que a sala NÃO estava na lista — sem distinguir
  // "ela morreu" de "ela ainda não nasceu". Entre iniciar a
  // transmissão e o webhook `room_started` propagar passam segundos, e
  // qualquer push de `rooms` nessa janela (alguém ficando online já
  // dispara um) soltava a supressão pra sempre. Aí, quando a sala
  // finalmente aparecia, ela aparecia PRA MIM na minha própria lista.
  //
  // Numa live PRIVADA isso era garantido em vez de eventual: o host
  // nem recebia a própria sala (ver o bug do canSeeRoom, corrigido no
  // servidor no mesmo dia), então a supressão caía sempre — e a sala
  // brotava na lista do dono no primeiro "atualizar".
  const wasListedRef = useRef(false)

  // Nova transmissão começou — passa a suprimir o código novo (sempre o
  // MAIS RECENTE; nunca acumula mais de um, já que só existe uma
  // transmissão própria por vez).
  useEffect(() => {
    if (startedRoomCode && startedRoomCode !== hiddenCodeRef.current) {
      hiddenCodeRef.current = startedRoomCode
      // Zera junto: é uma sala NOVA, ainda não vista na lista.
      wasListedRef.current = false
      setHiddenCode(startedRoomCode)
    }
  }, [startedRoomCode])

  // Solta a supressão só quando a sala suprimida APARECEU e depois
  // SUMIU da lista em tempo real — nunca antes disso, mesmo que
  // `startedRoomCode` (o useGstreamerTransmission) já tenha voltado a
  // `null` nesse meio tempo.
  //
  // As duas metades importam: sem a de "apareceu", qualquer atualização
  // de lista antes da sala nascer derruba a supressão (ver wasListedRef
  // acima); sem a de "sumiu", a supressão nunca acabaria.
  useEffect(() => {
    const code = hiddenCodeRef.current
    if (!code) return

    const listed = rooms.some((room) => room.name === code)
    if (listed) {
      wasListedRef.current = true
      return
    }

    // Fora da lista, mas nunca esteve nela: a sala ainda está subindo.
    // Continua suprimida — é justamente agora que ela não pode escapar.
    if (!wasListedRef.current) return

    // AINDA ESTOU TRANSMITINDO ESSA SALA (2026-09-20).
    //
    // Bug real: sumir da lista deixou de significar "acabou". Quando o
    // app reinicia o pipeline pra trocar de fonte, a sala pode morrer e
    // renascer no servidor no meio do caminho (era o que acontecia no
    // fim de uma partida de LoL — ver roomReconnect.ts). Soltar a
    // supressão nesse intervalo era definitivo: o efeito que suprime
    // depende de `startedRoomCode` MUDAR, e ele não muda nessa
    // hora — o app nem soube que a sala piscou. Resultado: a live
    // voltava e a pessoa passava o resto dela vendo a própria sala na
    // lista.
    //
    // Enquanto a transmissão em curso for essa, some da lista é
    // acidente, não fim.
    if (startedRoomCode === code) return

    hiddenCodeRef.current = null
    wasListedRef.current = false
    setHiddenCode(null)
  }, [rooms, startedRoomCode])

  return hiddenCode
}
