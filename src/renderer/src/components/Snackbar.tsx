import { useEffect, useState } from 'react'
import { AlertCircle, Info, X } from 'lucide-react'

interface SnackbarProps {
  message: string | null
  isError?: boolean
  onClose: () => void
}

// Tempo da animação de saída (ver .snackbar-closing/@keyframes no CSS) —
// o componente continua montado até esse tanto de tempo passar, senão o
// `message` viraria null (via useSnackbar) e ele sumiria na hora, sem dar
// tempo da animação de descida rodar.
const EXIT_DURATION_MS = 220

// Guarda a última mensagem/flag "de verdade" recebida, porque quando
// `message` vira null (auto-hide do useSnackbar, ou o `x`) ainda precisa
// renderizar ESSE texto/ícone durante a animação de saída. Ajusta esse
// estado DURANTE o render (não num efeito, nem via ref — regra nova do
// react-compiler proíbe ler/escrever ref durante o render) comparando
// com `prevMessage`, guardado em STATE de propósito: é exatamente o
// padrão "storing information from previous renders" documentado pelo
// próprio React pra reagir a uma prop mudando sem efeito.
function Snackbar({ message, isError, onClose }: SnackbarProps): React.JSX.Element | null {
  const [shown, setShown] = useState<{ text: string; isError: boolean } | null>(null)
  const [closing, setClosing] = useState(false)
  const [prevMessage, setPrevMessage] = useState(message)

  if (message !== prevMessage) {
    setPrevMessage(message)
    if (message) {
      setShown({ text: message, isError: Boolean(isError) })
      setClosing(false)
    } else {
      setClosing(true)
    }
  }

  useEffect(() => {
    if (!closing) return
    const timeout = setTimeout(() => setShown(null), EXIT_DURATION_MS)
    return () => clearTimeout(timeout)
  }, [closing])

  if (!shown) return null

  return (
    <div
      className={`snackbar${shown.isError ? ' snackbar-error' : ''}${closing ? ' snackbar-closing' : ''}`}
      role="status"
    >
      {shown.isError ? (
        <AlertCircle size={18} className="snackbar-icon" />
      ) : (
        <Info size={18} className="snackbar-icon" />
      )}
      <span className="snackbar-text">{shown.text}</span>
      <button type="button" className="snackbar-close" onClick={onClose} aria-label="Fechar">
        <X size={16} />
      </button>
    </div>
  )
}

export default Snackbar
