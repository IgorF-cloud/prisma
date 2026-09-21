import newLiveSrc from '../assets/sounds/newLive.mp3'
import stopLiveSrc from '../assets/sounds/stopLive.mp3'
import newViewerSrc from '../assets/sounds/newViewer.mp3'
import viewerOutSrc from '../assets/sounds/viewerOut.mp3'

// Roadmap item 35: efeitos sonoros. Reformulado a pedido do usuário
// (2026-09-06) — antes eram só dois arquivos genéricos (in/out) tocados
// pra entrada/saída em QUALQUER sala de interesse; agora cada evento tem
// o seu, e o público de cada um é diferente:
//
//   newLive    HOST ao iniciar a própria live + TODO viewer quando uma
//              sala nova aparece na lista dele (esse segundo caso é o
//              único que passa pela preferência `alertForNewLives`, ver
//              useNewLiveSound.ts).
//   stopLive   HOST ao parar a própria live + os viewers que ESTAVAM
//              assistindo a sala derrubada (ver useViewer.ts).
//   newViewer  só o HOST, quando alguém entra na live dele.
//   viewerOut  só o HOST, quando alguém sai da live dele.
//
// Os antigos in.mp3/out.mp3 foram removidos junto: com newViewer/
// viewerOut restritos ao host, nada mais os usava (entrada/saída de
// gente numa sala que eu só ASSISTO passou a ser silenciosa, decisão
// confirmada com o usuário).
const SOUND_SOURCES = {
  newLive: newLiveSrc,
  stopLive: stopLiveSrc,
  newViewer: newViewerSrc,
  viewerOut: viewerOutSrc
} as const

export type SoundKey = keyof typeof SOUND_SOURCES

// Pedido do usuário (2026-09-03): os alertas tocavam muito altos mesmo
// com o volume do Windows baixo. Não tem como "ler" o nível do slider de
// volume do sistema a partir daqui (o Chromium não expõe isso pro
// renderer, e nem precisaria — o Windows já escala TUDO que o app emite
// pelo volume geral automaticamente, igual qualquer outro programa). O
// problema real era outro: um `<audio>` novo sempre começa com
// `volume = 1` (o pico máximo do PRÓPRIO arquivo), e esses arquivos são
// mp3 de efeito sonoro masterizados bem "quentes" — daí soarem
// desproporcionalmente altos mesmo com o sistema baixo. Correção: reduz
// o ganho de reprodução ANTES de qualquer escala do sistema, não depois.
const ALERT_VOLUME = 0.5

// Uma instância de `Audio` nova a cada chamada (em vez de reaproveitar
// uma global) — permite sons sobrepostos (ex: dois viewers entrando em
// sequência rápida) sem cortar a reprodução anterior no meio.
// `.catch(() => {})` só engole a rejeição se o navegador bloquear
// autoplay por algum motivo (não deveria acontecer aqui — é sempre
// disparado em resposta a um evento em tempo real dentro do app já em
// uso, não um autoplay ao carregar a página).
export function playSound(key: SoundKey): void {
  const audio = new Audio(SOUND_SOURCES[key])
  audio.volume = ALERT_VOLUME
  audio.play().catch(() => {})
}
