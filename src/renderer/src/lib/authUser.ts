import { AvatarRef } from './avatar'

// Preferências por conta (pedido do usuário, 2026-09-06) — vêm do
// token-server dentro do próprio objeto do usuário, em /login, /register
// e no PUT /users/:id. Contas antigas não têm o campo gravado em disco: o
// server costura os defaults na leitura (ver `settingsOf` no server.js),
// então aqui isso nunca chega parcial.
export interface UserSettings {
  // Se o alerta sonoro de "uma sala nova apareceu na lista" (newLive.mp3)
  // toca. Ligado por padrão. NÃO afeta o som de iniciar a PRÓPRIA live:
  // esse é resposta a um clique do usuário, não um alerta (decisão
  // confirmada com o usuário) — ver useGstreamerTransmission.ts.
  alertForNewLives: boolean
  // Sobreposição de viewers na tela durante a live (2026-09-10).
  // Nasce DESLIGADA: ela desenha por cima da tela do usuário.
  showViewersOverlay: boolean
}

// Esse tipo vinha DUPLICADO em App.tsx, HomeScreen.tsx e
// UserProfileModal.tsx. Centralizado ao adicionar `settings`
// (2026-09-06) pelo mesmo motivo do `NowPlayingInfo` (ver
// nowPlaying.ts): com cópias soltas, um campo novo entra em algumas e
// esquece as outras. O main e o preload mantêm as suas de propósito —
// descrevem a fronteira de IPC e não importam de dentro do renderer.
export interface AuthUser {
  id: number
  name: string
  // Só vem nas rotas do PRÓPRIO usuário (login, /me, PUT /users/:id).
  // O GET /users, que lista todo mundo pra sidebar, NÃO traz e-mail —
  // ver publicUser x privateUser em db/users.js no servidor.
  email: string
  avatar: AvatarRef | null
  // Preferência de presença (item 11, 2026-09-10). NÃO é o estado: o
  // "online" que os outros veem depende de ter o app aberto, e isso o
  // servidor deriva do WebSocket (ver presence.js lá).
  presence: 'available' | 'busy'
  settings: UserSettings
}
