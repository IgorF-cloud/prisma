import { FormEvent, useState } from 'react'
import { ArrowRight, Hash, X } from 'lucide-react'
import { getErrorMessage } from '../lib/errors'

interface JoinByCodeModalProps {
  onClose: () => void
  onJoin: (code: string) => Promise<{ ok: boolean; error?: string }>
}

// Item 9 do ROADMAP (2026-09-10) — entrar numa sala digitando o código.
//
// O "código" é o próprio nome da sala: 6 dígitos gerados pelo host (ver
// generateRoomCode em useGstreamerTransmission.ts). Por isso entrar por
// código é literalmente o mesmo caminho de clicar num tile da lista.
//
// Sala PRIVADA não entra por aqui — quem recusa é o servidor, no /token
// (ver presence.isAllowedInRoom no server.js), e a mensagem de erro dele
// aparece aqui. A checagem NÃO é feita no cliente de propósito: se
// fosse, bastaria adivinhar o código pra entrar em qualquer sala.
function JoinByCodeModal({ onClose, onJoin }: JoinByCodeModalProps): React.JSX.Element {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (code.length !== 6) {
      setError('O código tem 6 dígitos.')
      return
    }

    setError(null)
    setJoining(true)
    try {
      const result = await onJoin(code)
      if (result.ok) {
        onClose()
      } else {
        setError(result.error ?? 'Não foi possível entrar nessa sala.')
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Não foi possível entrar nessa sala.'))
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="join-code-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-button join-code-close" onClick={onClose} aria-label="Fechar">
          <X size={16} />
        </button>

        <div className="auth-card-icon">
          <Hash size={22} />
        </div>
        <h2 className="join-code-title">Entrar com código</h2>
        <p className="join-code-subtitle">Digite o código de 6 dígitos da transmissão</p>

        <form className="join-code-form" onSubmit={handleSubmit}>
          {/* Filtra no onChange, que é a fonte de verdade — `inputMode` e
              `maxLength` são só affordance nativa e não seguram um
              "colar" de texto não-numérico. */}
          <input
            className="join-code-input"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            aria-label="Código da sala"
            autoFocus
          />

          {error && <p className="auth-error">{error}</p>}

          <button
            type="submit"
            className="auth-submit"
            disabled={joining || code.length !== 6}
          >
            {joining ? 'Entrando...' : 'Entrar'}
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}

export default JoinByCodeModal
