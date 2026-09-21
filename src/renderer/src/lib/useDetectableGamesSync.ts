import { useEffect, useState } from 'react'

interface UseDetectableGamesSyncResult {
  // true só enquanto o main está de fato baixando uma lista nova (cache
  // local vencido ou inexistente) — se o cache ainda estiver fresco, isso
  // nunca vira true, o app.tsx não mostra overlay nenhum.
  updating: boolean
  progress: number
}

// Item 29 do roadmap: garante que a lista de jogos detectáveis (usada pra
// reconhecer jogos não-Steam pelo processo em execução) está atualizada
// logo ao abrir o app — dispara uma vez, o main decide sozinho (ver
// gameDetectableCache.ts) se precisa baixar de novo ou se o cache de
// poucos dias atrás ainda serve.
export function useDetectableGamesSync(): UseDetectableGamesSyncResult {
  const [updating, setUpdating] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    window.api.games.ensureDetectableList()
  }, [])

  useEffect(() => {
    const offStart = window.api.games.onListDownloadStart(() => {
      setProgress(0)
      setUpdating(true)
    })
    const offProgress = window.api.games.onListDownloadProgress(setProgress)
    const offDone = window.api.games.onListDownloadDone(() => setUpdating(false))
    return () => {
      offStart()
      offProgress()
      offDone()
    }
  }, [])

  return { updating, progress }
}
