import { Monitor, Video } from 'lucide-react'

export type TransmitKind = 'screen' | 'cam'

interface TransmitKindSwitchProps {
  active: TransmitKind
  onChange: (kind: TransmitKind) => void
}

// A CHAVE "TELA | VÍDEO" do seletor de fonte (2026-10-22, pedido do
// usuário): o botão de transmitir da barra virou um só, e a escolha do que
// transmitir mora aqui, no topo da janela.
//
// Por baixo continuam DUAS janelas — a da tela (SourcePickerDialog) e a da
// câmera (WebcamPickerDialog) —, do mesmo tamanho e no mesmo lugar, e a
// chave troca uma pela outra sem a animação de abrir (ver `instant` nas
// duas). Assim cada uma segue podendo abrir SOZINHA, sem a chave: é o
// "Adicionar transmissão de vídeo/tela" do rodapé.
function TransmitKindSwitch({ active, onChange }: TransmitKindSwitchProps): React.JSX.Element {
  return (
    <div className="transmit-kind-switch" role="tablist" aria-label="O que transmitir">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'screen'}
        className={`transmit-kind-option${active === 'screen' ? ' transmit-kind-option-active' : ''}`}
        onClick={() => onChange('screen')}
      >
        <span className="transmit-kind-icon">
          <Monitor size={17} />
        </span>
        <span className="transmit-kind-text">
          <span className="transmit-kind-title">Tela</span>
          <span className="transmit-kind-hint">Um monitor ou uma janela</span>
        </span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'cam'}
        className={`transmit-kind-option${active === 'cam' ? ' transmit-kind-option-active' : ''}`}
        onClick={() => onChange('cam')}
      >
        <span className="transmit-kind-icon">
          <Video size={17} />
        </span>
        <span className="transmit-kind-text">
          <span className="transmit-kind-title">Vídeo</span>
          <span className="transmit-kind-hint">A sua webcam</span>
        </span>
      </button>
    </div>
  )
}

export default TransmitKindSwitch
