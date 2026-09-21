import { useCallback, useRef, useState } from 'react'

const DEFAULT_DURATION_MS = 5000

interface ShowOptions {
  // Flag pra diferenciar aviso neutro (ex: "Transmissão encerrada") de
  // erro de verdade (ex: falha ao entrar numa sala) — o <Snackbar> usa
  // isso só pra pintar vermelho em vez do neutro padrão.
  error?: boolean
  // Quanto tempo fica na tela. **0 = fica até alguém tirar** — usado
  // no upload de foto (2026-09-11), que dura o que a rede quiser: um
  // timer fixo faria a mensagem sumir no meio do envio. Quem mostra
  // com 0 é responsável por chamar `show` de novo (com uma duração)
  // ou `hide` quando terminar.
  durationMs?: number
}

interface UseSnackbarResult {
  message: string | null
  isError: boolean
  show: (text: string, options?: ShowOptions) => void
  // Fecha na hora (botão "x" no <Snackbar>) — sem isso o timeout do
  // `show()` ainda dispararia depois e tentaria esconder de novo.
  hide: () => void
}

// Vive uma vez só, instanciado em App.tsx, e repassado como props pro
// componente <Snackbar> (ver ../components/Snackbar.tsx) — assim
// qualquer tela/hook pode disparar uma mensagem (ex: useViewer.ts
// avisando que o host encerrou a live) sem precisar de um componente
// próprio de mensagem em cada lugar.
export function useSnackbar(): UseSnackbarResult {
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setMessage(null)
  }, [])

  const show = useCallback((text: string, options?: ShowOptions) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setMessage(text)
    setIsError(options?.error ?? false)

    const duration = options?.durationMs ?? DEFAULT_DURATION_MS
    // `=== 0` e não um `if (duration)` genérico: um valor negativo
    // por engano cairia no mesmo balde e a mensagem ficaria presa
    // sem ninguém entender por quê.
    if (duration === 0) return

    timeoutRef.current = setTimeout(() => setMessage(null), duration)
  }, [])

  return { message, isError, show, hide }
}
