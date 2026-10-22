import { Monitor, Plus, Video } from 'lucide-react'

interface AddTransmissionTileProps {
  kind: 'screen' | 'cam'
  onClick: () => void
}

// "ADICIONAR TRANSMISSÃO" no rodapé da minha live (2026-10-22, pedido do
// usuário — voltou, era o cartão tracejado da etapa 4). Ocupa a vaga da
// transmissão que NÃO está no ar e abre o seletor de fonte exclusivo
// dela: com a tela no ar, o de vídeo; com o vídeo no ar, o de tela.
function AddTransmissionTile({ kind, onClick }: AddTransmissionTileProps): React.JSX.Element {
  const isCam = kind === 'cam'
  return (
    <button type="button" className={`ml-tile-add ml-tile-add-${kind}`} onClick={onClick}>
      <span className="ml-tile-add-icon">
        {isCam ? <Video size={18} /> : <Monitor size={18} />}
        <span className="ml-tile-add-plus">
          <Plus size={11} strokeWidth={3.5} />
        </span>
      </span>
      <span className="ml-tile-add-text">
        <span className="ml-tile-add-title">
          {isCam ? 'Adicionar transmissão de vídeo' : 'Adicionar transmissão de tela'}
        </span>
        <span className="ml-tile-add-hint">
          {isCam ? 'A sua webcam, na mesma sala' : 'Um monitor ou uma janela, na mesma sala'}
        </span>
      </span>
    </button>
  )
}

export default AddTransmissionTile
