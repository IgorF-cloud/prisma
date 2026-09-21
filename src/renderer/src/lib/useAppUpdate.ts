import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from './errors'

export type UpdateStage = 'prompt' | 'downloading' | 'installing' | 'error'

interface UpdateInfo {
  version: string
  url: string
  sha256: string
}

interface UseAppUpdateResult {
  // O FATO: existe uma versão publicada mais nova que a instalada. null
  // enquanto não se sabe (ou já se sabe que não há). É o que acende o
  // botão de atualizar na titlebar.
  updateInfo: UpdateInfo | null
  // A VISIBILIDADE do diálogo — coisa separada do fato desde 2026-09-20.
  // Ver o comentário em `dismiss`.
  dialogOpen: boolean
  currentVersion: string
  stage: UpdateStage
  progress: number
  error: string | null
  canDismiss: boolean
  startUpdate: () => Promise<void>
  dismiss: () => void
  // Reabre o diálogo depois de um "agora não" — o botão da titlebar.
  openDialog: () => void
}

// Checagem automática ao abrir o app (mesmo espírito do
// _loadAppVersionAndCheckUpdate do app Flutter, disparada só depois do
// login — ver `enabled`) — GET /version no token-server via IPC (main,
// que tem o API_TOKEN). Silenciosa: sem servidor ou erro de rede aqui
// não deve incomodar o usuário (o próprio handler do main já engole o
// erro e devolve `available: false`, ver src/main/update.ts).
export function useAppUpdate(enabled: boolean): UseAppUpdateResult {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentVersion, setCurrentVersion] = useState('')
  const [stage, setStage] = useState<UpdateStage>('prompt')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    window.api.update.check().then((result) => {
      setCurrentVersion(result.currentVersion)
      if (result.available) {
        setUpdateInfo(result.info)
        // No login o diálogo abre sozinho, como sempre foi.
        setDialogOpen(true)
      }
    })
  }, [enabled])

  // Espelha o estágio pro push abaixo poder consultá-lo sem virar
  // dependência do efeito (que monta uma vez só).
  const stageRef = useRef<UpdateStage>(stage)
  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  // PUBLICAÇÃO EM TEMPO REAL (2026-09-20, pedido do usuário).
  //
  // O servidor anuncia pelo WebSocket assim que uma versão é publicada
  // no painel admin, o main refaz a checagem e empurra o resultado (ver
  // src/main/rooms.ts e update.ts). Aqui isso só acende o BOTÃO: abrir
  // um modal por cima de quem pode estar no meio de uma live seria
  // sequestrar a tela de alguém por uma notícia que pode esperar um
  // clique.
  useEffect(
    () =>
      window.api.update.onAvailability((result) => {
        setCurrentVersion(result.currentVersion)
        if (result.available) {
          setUpdateInfo(result.info)
          return
        }
        // Não há mais atualização (ex: republicaram uma versão anterior)
        // — apaga o botão, a não ser que já exista um download/instalação
        // em andamento, que não pode ter o chão puxado embaixo dele.
        if (stageRef.current === 'prompt') setUpdateInfo(null)
      }),
    []
  )

  useEffect(() => window.api.update.onDownloadProgress(setProgress), [])

  const startUpdate = useCallback(async () => {
    if (!updateInfo) return
    setStage('downloading')
    setProgress(0)
    setError(null)

    try {
      const installerPath = await window.api.update.download(updateInfo)

      setStage('installing')
      // Dá tempo da UI mostrar "instalando" antes do app fechar sozinho —
      // install() só resolve depois do instalador já ter começado (o
      // usuário pode precisar responder UAC/SmartScreen antes disso), e o
      // app se encerra ~500ms depois disso resolver (ver
      // src/main/update.ts).
      await window.api.update.install(installerPath)
    } catch (err) {
      setStage('error')
      setError(getErrorMessage(err, 'Erro inesperado ao atualizar'))
    }
  }, [updateInfo])

  // "Agora não" fecha o DIÁLOGO e só isso (2026-09-20). Antes ele
  // zerava o `updateInfo`, e com isso a informação de que existe
  // atualização sumia até o app reiniciar — não havia como voltar atrás
  // de uma recusa. Agora o fato continua guardado, o botão verde da
  // titlebar fica lá, e reabrir é um clique.
  const dismiss = useCallback(() => {
    setDialogOpen(false)
  }, [])

  const openDialog = useCallback(() => {
    // Recusou depois de um erro e voltou pelo botão: começa do começo,
    // senão o diálogo reabriria na tela de "não foi possível atualizar"
    // de uma tentativa que já passou.
    if (stage === 'error') {
      setStage('prompt')
      setError(null)
    }
    setDialogOpen(true)
  }, [stage])

  return {
    updateInfo,
    dialogOpen,
    currentVersion,
    stage,
    progress,
    error,
    canDismiss: stage === 'prompt' || stage === 'error',
    startUpdate,
    dismiss,
    openDialog
  }
}
