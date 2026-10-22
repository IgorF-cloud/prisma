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
  // Atualização obrigatória (2026-10-22). Só a checagem do LOGIN liga
  // isto — ver o efeito do `check()` abaixo.
  required: boolean
  startUpdate: () => Promise<void>
  // Desiste do download em andamento e volta o diálogo pro começo
  // (2026-09-21).
  cancelDownload: () => void
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
  const [required, setRequired] = useState(false)

  useEffect(() => {
    if (!enabled) return
    window.api.update.check().then((result) => {
      setCurrentVersion(result.currentVersion)
      if (result.available) {
        setUpdateInfo(result.info)
        // OBRIGATÓRIA SÓ AQUI, no login (2026-10-22, pedido do usuário).
        // Se a versão instalada está abaixo da mínima, o diálogo perde o
        // "Agora não" e não fecha mais. O push que chega com o app aberto
        // (logo abaixo) ignora o `required` de propósito: ninguém é
        // tirado do meio de uma live por uma publicação — a obrigação
        // vale a partir do próximo login.
        setRequired(result.required)
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
        // Sem atualização não há o que obrigar: um diálogo obrigatório
        // aberto some junto.
        if (stageRef.current === 'prompt') {
          setUpdateInfo(null)
          setRequired(false)
        }
      }),
    []
  )

  useEffect(() => window.api.update.onDownloadProgress(setProgress), [])

  // Cancelar aborta o fetch no main, e abortar faz o `download()` acima
  // REJEITAR — do ponto de vista do `catch`, um cancelamento é
  // indistinguível de um erro de rede. Sem esta marca, desistir do
  // download cairia na tela vermelha de "não foi possível atualizar",
  // acusando o app de uma falha que foi um clique do usuário.
  const cancelledRef = useRef(false)

  const startUpdate = useCallback(async () => {
    if (!updateInfo) return
    cancelledRef.current = false
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
      // A tela já foi devolvida pelo cancelDownload — nada a relatar.
      if (cancelledRef.current) return
      setStage('error')
      setError(getErrorMessage(err, 'Erro inesperado ao atualizar'))
    }
  }, [updateInfo])

  // Desistir do download (2026-09-21, pedido do usuário): a conexão cai
  // no main, o .exe pela metade é apagado lá, e aqui a tela volta pro
  // estado de antes de clicar em "atualizar agora" — diálogo fechado,
  // botão verde da titlebar aceso, exatamente como o "agora não".
  //
  // Só vale enquanto está BAIXANDO. Depois disso o instalador já está no
  // disco e o app está prestes a fechar: "cancelar" ali não teria o que
  // desfazer, e o clique que chegasse atrasado (o download terminou
  // entre ver o botão e apertá-lo) apagaria a tela de "instalando" sem
  // impedir nada.
  //
  // Obrigatória, o cancelar volta pro começo do diálogo em vez de
  // fechá-lo: desistir do download não pode virar a porta de saída que o
  // "Agora não" deixou de ser.
  const cancelDownload = useCallback(() => {
    if (stageRef.current !== 'downloading') return
    cancelledRef.current = true
    void window.api.update.cancel()
    setStage('prompt')
    setProgress(0)
    if (!required) setDialogOpen(false)
  }, [required])

  // "Agora não" fecha o DIÁLOGO e só isso (2026-09-20). Antes ele
  // zerava o `updateInfo`, e com isso a informação de que existe
  // atualização sumia até o app reiniciar — não havia como voltar atrás
  // de uma recusa. Agora o fato continua guardado, o botão verde da
  // titlebar fica lá, e reabrir é um clique.
  const dismiss = useCallback(() => {
    if (required) return
    setDialogOpen(false)
  }, [required])

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
    canDismiss: !required && (stage === 'prompt' || stage === 'error'),
    required,
    startUpdate,
    cancelDownload,
    dismiss,
    openDialog
  }
}
