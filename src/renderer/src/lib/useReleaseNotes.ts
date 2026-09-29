import { useCallback, useEffect, useState } from 'react'
import { findRelease, RELEASE_NOTES } from './releaseNotes'

// Quando a janela de notas abre SOZINHA (2026-09-25, pedido do usuário).
//
// A regra é uma só: uma vez por versão. Quem atualizou vê o que mudou
// assim que entra; quem já viu não vê de novo, nem reabrindo o app.
//
// O que fica guardado é a versão que a pessoa JÁ VIU, e não um "já
// mostrei" ligado/desligado. Um booleano exigiria lembrar de desligá-lo
// a cada release (e esquecer disso é silencioso: ninguém mais veria nota
// nenhuma, pra sempre). Guardando o número, a comparação com a versão
// instalada responde sozinha, sem nada pra manter.
const STORAGE_KEY = 'prisma:seen-release-notes'

// localStorage, e não um arquivo em `userData` via IPC: a informação é
// por MÁQUINA (foi este computador que atualizou) e é lida uma vez, na
// montagem. Mesmo raciocínio do lastTransmissionQuality.ts — ver o
// comentário de lá pro contraste com session.ts, que precisa do main.
//
// Os dois acessos são protegidos porque localStorage lança quando o
// armazenamento está bloqueado. Falhar aqui não pode impedir o app de
// abrir: na leitura o preço é a janela aparecer de novo, e na escrita é
// ela não parar de aparecer — chato, nunca grave.
function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeSeenVersion(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version)
  } catch {
    /* sem armazenamento: a janela volta na próxima abertura */
  }
}

export interface ReleaseNotesState {
  isOpen: boolean
  // A versão que está rodando. Vem daqui, e não de uma segunda busca no
  // componente, porque este hook já precisou dela pra decidir se abria
  // sozinho — pedir de novo seria um IPC pra saber algo que já se sabe.
  installedVersion: string
  // Qual versão a janela abre selecionada. Na abertura automática é a
  // que acabou de ser instalada; no clique do botão, a mais nova que
  // tem nota escrita.
  initialVersion: string
  open: () => void
  close: () => void
}

// `enabled` = já há usuário logado. A janela não pode aparecer por cima
// do login: ali a pessoa ainda não entrou no app, e uma lista de
// novidades antes da senha é interrupção, não informação.
export function useReleaseNotes(enabled: boolean): ReleaseNotesState {
  const [isOpen, setIsOpen] = useState(false)
  const [initialVersion, setInitialVersion] = useState('')
  const [installedVersion, setInstalledVersion] = useState('')

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    window.api.app.getVersion().then((installed) => {
      if (cancelled) return
      setInstalledVersion(installed)
      // Sem nota escrita pra esta versão, não há o que abrir — e o
      // "já viu" NÃO é gravado: se a nota chegar numa versão seguinte,
      // ela ainda tem chance de aparecer. Ver o aviso no topo de
      // releaseNotes.ts.
      if (!findRelease(installed)) return
      if (readSeenVersion() === installed) return

      // Gravado ao ABRIR, e não ao fechar: fechar tem vários caminhos
      // (o X, o Esc, o clique fora) e o app pode ser encerrado com a
      // janela aberta. Marcando aqui, "apareceu uma vez" é exatamente o
      // que fica registrado.
      writeSeenVersion(installed)
      setInitialVersion(installed)
      setIsOpen(true)
    })

    return () => {
      cancelled = true
    }
  }, [enabled])

  // Abertura pelo botão da titlebar: começa na versão mais recente que
  // tem nota. Não usa a instalada porque as duas são a mesma coisa no
  // caminho normal — e quando não são (uma build de teste à frente das
  // notas), mostrar a lista vazia seria pior que mostrar a última nota
  // escrita.
  const open = useCallback(() => {
    setInitialVersion(RELEASE_NOTES[0]?.version ?? '')
    setIsOpen(true)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  return { isOpen, installedVersion, initialVersion, open, close }
}
