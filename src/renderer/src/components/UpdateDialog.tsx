import { useEffect } from 'react'
import { AlertCircle, ArrowRight, Download, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react'
import { UpdateStage } from '../lib/useAppUpdate'
import { formatAppVersion } from '../lib/appVersion'

interface UpdateDialogProps {
  currentVersion: string
  newVersion: string
  stage: UpdateStage
  progress: number
  error: string | null
  canDismiss: boolean
  // Atualização obrigatória (2026-10-22): sem "Agora não", sem "Fechar"
  // na tela de erro e sem fechar clicando fora. Ver `required` em
  // useAppUpdate.ts — só a checagem do login liga isto.
  required: boolean
  // Há uma transmissão no ar agora. Ver o aviso no estágio `prompt`.
  transmitting: boolean
  onStart: () => void
  onCancelDownload: () => void
  onDismiss: () => void
}

// Diálogo de atualização — mesmo fluxo do app Flutter (ver
// lib/components/update_dialog.dart): prompt (versão atual vs nova) →
// downloading (barra de progresso real) → installing (instalador Inno
// Setup assume, o app fecha sozinho em seguida) → error (com "tentar de
// novo"). Só pode ser dispensado nos estágios prompt/error (ver
// canDismiss em useAppUpdate.ts) — durante download/instalação, sumir
// com o diálogo deixaria um download de ~100 MB correndo escondido ou um
// UAC pendente sem explicação na tela.
//
// Sair do download tem um caminho PRÓPRIO desde 2026-09-21: o botão
// "Cancelar", que derruba a conexão antes de fechar (onCancelDownload).
// É diferente de dispensar justamente por isso — desistir precisa
// cancelar de verdade, não só tirar a janela da frente.
//
// Visual refeito em 2026-10-22 (pedido do usuário) na linguagem dos
// dialogs mais novos (SourcePickerDialog): fundo desfocado, halo roxo no
// topo, entrada com um leve salto. Todo estágio tem o mesmo esqueleto —
// ícone-em-pill, título, texto, conteúdo, ações — pra troca de um pro
// outro não mudar a forma do cartão.
function UpdateDialog({
  currentVersion,
  newVersion,
  stage,
  progress,
  error,
  canDismiss,
  required,
  transmitting,
  onStart,
  onCancelDownload,
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
  //
  // Obrigatória, isto também é o que impede usar o app por trás do
  // diálogo. Os botões de minimizar/fechar continuam funcionando: são os
  // nativos do Windows (titleBarOverlay, ver src/main/index.ts), que
  // ficam fora do DOM.
  useEffect(() => {
    document.body.classList.add('app-dialog-open')
    return () => document.body.classList.remove('app-dialog-open')
  }, [])

  const percent = Math.min(100, Math.max(0, Math.round(progress * 100)))

  return (
    <div
      className="modal-backdrop update-dialog-backdrop"
      onClick={() => {
        if (canDismiss) onDismiss()
      }}
    >
      <div
        className={`update-dialog${required ? ' update-dialog-required' : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {stage === 'prompt' && (
          <>
            {required && (
              <span className="update-dialog-badge">
                <ShieldAlert size={13} />
                Atualização obrigatória
              </span>
            )}
            <div className="update-dialog-icon">
              <Sparkles size={26} />
            </div>
            <h2 className="update-dialog-title">
              {required ? 'Atualize pra continuar' : 'Nova versão disponível'}
            </h2>
            <p className="update-dialog-subtitle">
              {required
                ? 'Esta versão do Prisma não é mais compatível. Instale a nova pra continuar usando o app.'
                : 'Uma versão nova do Prisma está pronta pra instalar.'}
            </p>

            {/* Só a versão ATUAL vira "BETA" — a nova vem do servidor e
                continua sendo número, senão a comparação leria
                "BETA → BETA" e não diria nada. Ver
                src/renderer/src/lib/appVersion.ts. */}
            <div className="update-dialog-versions">
              <div className="update-dialog-version">
                <span className="update-dialog-version-label">Atual</span>
                <span className="update-dialog-version-value">
                  {formatAppVersion(currentVersion)}
                </span>
              </div>
              <ArrowRight size={16} className="update-dialog-versions-arrow" />
              <div className="update-dialog-version update-dialog-version-new">
                <span className="update-dialog-version-label">Nova</span>
                <span className="update-dialog-version-value">v{newVersion}</span>
              </div>
            </div>

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
              {!required && (
                <button type="button" className="pill-button" onClick={onDismiss}>
                  Agora não
                </button>
              )}
              <button type="button" className="pill-button pill-button-accent" onClick={onStart}>
                <Download size={15} />
                Atualizar agora
              </button>
            </div>
            <p className="update-dialog-footnote">O Prisma fecha e reabre sozinho ao terminar.</p>
          </>
        )}

        {stage === 'downloading' && (
          <>
            <div className="update-dialog-icon">
              <Download size={24} />
            </div>
            <h2 className="update-dialog-title">Baixando atualização</h2>
            <p className="update-dialog-subtitle">
              Versão <strong className="update-dialog-highlight">v{newVersion}</strong>
            </p>
            <div className="update-dialog-progress">
              <div className="update-dialog-progress-track">
                <div className="update-dialog-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <span className="update-dialog-progress-label">{percent}%</span>
            </div>
            {/* O instalador tem ~100 MB e nem toda conexão baixa isso
                rápido — sem uma saída aqui, quem clicou sem querer (ou
                escolheu a hora errada) ficava preso olhando a barra, já
                que o diálogo não aceita ser dispensado durante o
                download. Obrigatória, cancelar volta pro começo do
                diálogo em vez de fechá-lo (ver useAppUpdate.ts). */}
            <div className="update-dialog-actions">
              <button type="button" className="pill-button" onClick={onCancelDownload}>
                <X size={15} />
                Cancelar
              </button>
            </div>
          </>
        )}

        {stage === 'installing' && (
          <>
            <div className="update-dialog-icon update-dialog-icon-spinning">
              <span className="update-dialog-spinner" />
            </div>
            <h2 className="update-dialog-title">Instalando...</h2>
            <p className="update-dialog-subtitle">
              O Windows pode pedir permissão (UAC) ou avisar que o instalador não é reconhecido
              (SmartScreen) — aprove os dois. O app vai fechar e reabrir sozinho assim que a
              instalação começar.
            </p>
          </>
        )}

        {stage === 'error' && (
          <>
            <div className="update-dialog-icon update-dialog-icon-error">
              <AlertCircle size={26} />
            </div>
            <h2 className="update-dialog-title">Não foi possível atualizar</h2>
            <p className="update-dialog-subtitle">{error}</p>
            <div className="update-dialog-actions">
              {!required && (
                <button type="button" className="pill-button" onClick={onDismiss}>
                  Fechar
                </button>
              )}
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
