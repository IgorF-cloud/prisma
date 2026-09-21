// O Electron embrulha qualquer Error lançado dentro de um `ipcMain.handle`
// com um prefixo próprio antes de rejeitar a Promise do lado do renderer
// (ex: "Error invoking remote method 'auth:login': Error: Usuário não
// encontrado") — sem isso, toda mensagem de erro vinda do main (auth,
// livekit, gstreamer, update...) aparecia crua na tela em vez de só
// "Usuário não encontrado". Usado em todo lugar que captura o erro de uma
// chamada `window.api.*` pra extrair a mensagem de exibir pro usuário.
const IPC_ERROR_PREFIX_PATTERN = /^Error invoking remote method '[^']*':\s*(?:[\w.]*Error:\s*)*/

export function getErrorMessage(err: unknown, fallback = 'Erro inesperado'): string {
  if (!(err instanceof Error)) return fallback
  return err.message.replace(IPC_ERROR_PREFIX_PATTERN, '') || fallback
}
