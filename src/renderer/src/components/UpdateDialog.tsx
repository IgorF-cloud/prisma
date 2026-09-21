import { useEffect } from 'react'
import { AlertCircle, Download, RefreshCw, Sparkles } from 'lucide-react'
import { UpdateStage } from '../lib/useAppUpdate'
import { formatAppVersion } from '../lib/appVersion'

interface UpdateDialogProps {
  currentVersion: string
  newVersion: string
  stage: UpdateStage
  progress: number
  error: string | null
  canDismiss: boolean
  // Há uma transmissão no ar agora. Ver o aviso no estágio `prompt`.
  transmitting: boolean
  onStart: () => void
  onDismiss: () => void
}

// Diálogo de atualização — mesmo fluxo do app Flutter (ver
// lib/components/update_dialog.dart): prompt (versão atual vs nova) →
// downloading (barra de progresso real) → installing (instalador Inno
// Setup assume, o app fecha sozinho em seguida) → error (com "tentar de
// novo"). Só pode ser dispensado nos estágios prompt/error (ver
// canDismiss em useAppUpdate.ts) — durante download/instalação,
// interromper no meio deixaria um .exe pela metade ou um UAC pendente
// sem explicação na tela.
function UpdateDialog({
  currentVersion,
  newVersion,
  stage,
  progress,
  error,
  canDismiss,
  transmitting,
  onStart,
  onDismiss
}: UpdateDialogProps): React.JSX.Element {
  // A TITLEBAR PRECISA IR PRO PLANO DE BAIXO (2026-09-20, pedido do
  // usuário).
  //
  // `.app-titlebar` é `z-index: 1000` e o `.modal-backdrop`, 900 — a
  // faixa sempre ficou POR CIMA do escurecido. Isso nunca incomodou
  // porque ela não tinha nada clicável; com o botão de atualizar ali, o
  // diálogo passou a abrir por cima de um botão que continuava aceso,
  // com hover e clique funcionando atrás dele.
  //
  // A classe vai no `<body>` (mesmo caminho do `app-focus-mode`, ver
  // HomeScreen.tsx) porque a titlebar é montada no App.tsx, fora da
  // árvore deste componente — não há prop que alcance ela daqui. O CSS
  // rebaixa a faixa pra 850: abaixo do escurecido e ainda acima do tile
  // em modo foco (500), que é o outro motivo do 1000 existir.
  //
  // A limpeza é a parte que importa: se este componente desmontar sem
  // ela, a faixa fica rebaixada pra sempre.
  useEffect(() => {
    document.body.classList.add('app-dialog-open')
    return () => document.body.classList.remove('app-dialog-open')
  }, [])

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (canDismiss) onDismiss()
      }}
    >
      <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
        {stage === 'prompt' && (
          <>
            <div className="update-dialog-icon">
              <Sparkles size={26} />
            </div>
            <h2 className="update-dialog-title">Nova versão disponível</h2>
            <p className="update-dialog-subtitle">
              {/* Só a versão ATUAL vira "BETA" — a nova vem do servidor
                  e continua sendo número, senão a frase leria
                  "BETA → BETA" e não diria nada. Ver
                  src/renderer/src/lib/appVersion.ts. */}
              Versão atual <strong>{formatAppVersion(currentVersion)}</strong> {'→'} nova versão{' '}
              <strong className="update-dialog-highlight">v{newVersion}</strong>
            </p>
            {/* A instalação fecha o app (o Inno Setup assume, ver
                src/main/update.ts), e fechar o app encerra a
                transmissão e a sala junto. No login isso nunca
                importava — ninguém está ao vivo ali. Pelo botão da
                titlebar, importa. */}
            {transmitting && (
              <p className="update-dialog-warning">
                <AlertCircle size={14} />
                Sua transmissão será encerrada!
              </p>
            )}
            <div className="update-dialog-actions">
              <button type="button" className="pill-button" onClick={onDismiss}>
                Agora não
              </button>
              <button type="button" className="pill-button pill-button-accent" onClick={onStart}>
                <Download size={15} />
                Atualizar agora
              </button>
            </div>
          </>
        )}

        {stage === 'downloading' && (
          <>
            <p className="update-dialog-status">Baixando atualização...</p>
            <div className="update-dialog-progress-track">
              <div
                className="update-dialog-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              />
            </div>
            <p className="update-dialog-progress-label">
              {Math.min(100, Math.max(0, Math.round(progress * 100)))}%
            </p>
          </>
        )}

        {stage === 'installing' && (
          <>
            <span className="update-dialog-spinner" />
            <p className="update-dialog-status">Instalando...</p>
            <p className="update-dialog-subtitle">
              O Windows pode pedir permissão (UAC) ou avisar que o instalador não é reconhecido
              (SmartScreen) — aprove os dois. O app vai fechar e reabrir sozinho assim que a
              instalação começar.
            </p>
          </>
        )}

        {stage === 'error' && (
          <>
            <AlertCircle size={30} className="update-dialog-error-icon" />
            <p className="update-dialog-status">Não foi possível atualizar</p>
            <p className="update-dialog-subtitle">{error}</p>
            <div className="update-dialog-actions">
              <button type="button" className="pill-button" onClick={onDismiss}>
                Fechar
              </button>
              <button type="button" className="pill-button pill-button-accent" onClick={onStart}>
                <RefreshCw size={15} />
                Tentar de novo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default UpdateDialog
