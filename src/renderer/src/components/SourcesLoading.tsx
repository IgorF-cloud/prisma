// A espera das fontes de captura (2026-10-16, pedido do usuário): um
// spinner com texto, no centro da área onde a grade vai aparecer. Usado
// no dialog de fontes (iniciar e atualizar a live) — os dois
// carregam a mesma lista e devem esperar do mesmo jeito.
//
// Só aparece quando a lista ainda não chegou. A pré-carga do hover no
// botão de transmitir (ver SourcePickerDialog.tsx) continua valendo:
// quando ela chega a tempo, isto nem é montado.
function SourcesLoading(): React.JSX.Element {
  return (
    <div className="sources-loading" role="status" aria-live="polite">
      <span className="sources-loading-spinner" aria-hidden="true" />
      <span className="sources-loading-title">Buscando telas e janelas</span>
      <span className="sources-loading-hint">Preparando as miniaturas pra você escolher</span>
    </div>
  )
}

export default SourcesLoading
