import { BrowserWindow } from 'electron'

// O destaque laranja do botão do app na barra de tarefas.
//
// Nasceu pro convite pra uma live (2026-09-13), que saiu na etapa 5 do
// item 26. Desde a etapa 8 (2026-10-22) é dos ALERTAS: uma live nova que
// passa pela preferência da conta, e mensagem no chat de uma sala que eu
// assisto ou da minha.
//
// ---------------------------------------------------------------------
// POR QUE SÓ O `flashFrame`
//
// A primeira versão (2026-09-13) desenhava um ponto vermelho POR CIMA
// do ícone, com `setOverlayIcon`. O usuário testou e não gostou: o
// Windows estica o overlay pra caixa dele, e o resultado ficou grosseiro
// do lado do ícone do app. O `flashFrame` é o aviso NATIVO do Windows —
// o mesmo que o usuário já vê quando qualquer outro programa chama por
// ele.
// ---------------------------------------------------------------------
//
// `flashFrame(true)` no Windows usa FLASHW_TIMERNOFG: pisca e mantém o
// botão destacado ATÉ a janela receber foco, quando o próprio sistema
// apaga sozinho. Por isso não existe um "desligar" aqui: o alerta não
// tem fim próprio (não é guardado nem listado) — quem apaga é a pessoa
// voltar pro app.
export function flashTaskbar(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return

  // Com o app na frente é ruído puro: a pessoa já está olhando pra tela
  // onde o card (ou a mensagem) apareceu.
  if (mainWindow.isFocused()) return

  mainWindow.flashFrame(true)
}
