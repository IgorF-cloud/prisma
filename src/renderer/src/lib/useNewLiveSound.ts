import { useEffect, useRef } from 'react'
import { RoomInfo } from './useRooms'
import { playSound } from './sounds'

// Pedido do usuário (2026-09-06): alerta sonoro quando uma sala NOVA
// aparece na lista — ou seja, alguém que eu não estava vendo transmitir
// entrou no ar.
//
// A baseline (`knownRef`) é o ponto central: a primeira leitura da lista
// só REGISTRA quais salas já existem, sem tocar nada. Sem isso, abrir o
// app com cinco lives no ar dispararia cinco alertas de uma vez — e o
// mesmo aconteceria a cada reconexão do WebSocket de salas.
//
// `enabled` vem da preferência `alertForNewLives` da conta (ver
// SettingsModal.tsx). Importante: quando está desligado o hook continua
// rodando e mantendo a baseline atualizada, só não toca. Se ele saísse
// do ar, religar a opção faria todas as salas que apareceram no meio
// tocarem juntas no primeiro tick.
//
// A própria sala do usuário é ignorada: o som de iniciar a live dele
// já é tocado por useGstreamerTransmission (e não passa por essa
// preferência, por ser resposta a um clique dele).
//
// A baseline só funciona se a Home NASCER com a lista de agora. Até
// 2026-10-19 não nascia: a conexão do login libera a Home quando o
// WebSocket abre, às vezes antes do primeiro retrato das salas — a Home
// via a lista VAZIA, tomava isso como baseline, e a live que já estava
// no ar chegava um instante depois parecendo nova (o som tocava no
// login). Agora o loading do login e o splash do "manter conectado"
// buscam a lista por HTTP antes de liberar a Home (`load` em
// useRooms.ts), e a primeira observação daqui já é a lista certa.
export function useNewLiveSound(
  rooms: RoomInfo[],
  myRoomCode: string | null,
  enabled: boolean
): void {
  const knownRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    const currentCodes = new Set(rooms.map((room) => room.name))
    const previousCodes = knownRef.current

    // Primeira observação: só baseline, em silêncio.
    if (!previousCodes) {
      knownRef.current = currentCodes
      return
    }

    let apareceu = false
    for (const code of currentCodes) {
      if (previousCodes.has(code)) continue
      if (code === myRoomCode) continue
      apareceu = true
    }

    // A baseline avança SEMPRE, mesmo com o alerta desligado — ver o
    // comentário no topo.
    knownRef.current = currentCodes

    if (apareceu && enabled) playSound('newLive')
  }, [rooms, myRoomCode, enabled])
}
