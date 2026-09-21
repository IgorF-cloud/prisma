import { BrowserWindow } from 'electron'

// Aviso de convite no botão da barra de tarefas (2026-09-13): alguém te
// chamou pra uma live enquanto o app estava minimizado.
//
// ---------------------------------------------------------------------
// O QUE ERA ANTES, E POR QUE SAIU
//
// A primeira versão (do mesmo dia) desenhava um ponto vermelho POR CIMA
// do ícone, com `setOverlayIcon` — um PNG embutido em base64. O usuário
// testou e não gostou: o Windows estica o overlay pra caixa dele, e o
// resultado ficou grosseiro do lado do ícone do app.
//
// Ficou só o `flashFrame`, que é o aviso NATIVO do Windows: o botão
// inteiro pisca no laranja de notificação do sistema e continua aceso
// até a janela vir pra frente. Nada de desenho nosso competindo com o
// ícone — é a mesma coisa que o usuário já vê quando qualquer outro
// programa chama por ele.
// ---------------------------------------------------------------------
//
// `flashFrame(true)` no Windows usa FLASHW_TIMERNOFG: pisca e mantém o
// botão destacado ATÉ a janela receber foco, quando o próprio sistema
// apaga sozinho. Por isso o `false` aqui não é redundante — ele cobre o
// caso de o convite sumir (expirar ou ser cancelado) com o app ainda
// minimizado, em que ninguém deu foco em nada e o destaque ficaria aceso
// apontando pra um convite que não existe mais.
export function setInviteFlash(mainWindow: BrowserWindow, show: boolean): void {
  if (mainWindow.isDestroyed()) return

  // Piscar com o app aberto na frente é ruído puro: a pessoa já está
  // olhando pra tela onde o convite apareceu.
  if (show && mainWindow.isFocused()) return

  mainWindow.flashFrame(show)
}
