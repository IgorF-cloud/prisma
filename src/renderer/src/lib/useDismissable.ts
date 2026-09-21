import { useEffect } from 'react'

// Fechar "ao clicar fora" — compartilhado pelo card de perfil
// (UserCardPopover) e pelo menu de contexto (ContextMenu), 2026-09-13.
//
// O listener é de `click` e NÃO de `mousedown`, e isso é o que faz o
// clique-alterna funcionar. A sequência de um segundo clique no mesmo
// tile seria:
//
//   mousedown  ->  (fecharia aqui)
//   click      ->  o handler do tile abre de novo
//
// ...e a caixa nunca fecharia. Com `click`, o tile chama
// `stopPropagation()` no próprio handler e o evento nem chega ao
// documento — quem decide abrir ou fechar é só o tile.
//
// Desde o React 17 isso funciona: os handlers são anexados ao container
// da raiz, e o `stopPropagation` do React chama o do evento nativo, que
// realmente interrompe a subida até o `document`.
//
// Scroll com `capture: true` pega o scroll de QUALQUER ancestral, não
// só o da janela: as três listas rolam por dentro, e a caixa é `fixed`
// — sem isso ela ficaria parada no ar enquanto o tile some por baixo.
export function useDismissable(onDismiss: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onDismiss()
    }

    document.addEventListener('click', onDismiss)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)

    return () => {
      document.removeEventListener('click', onDismiss)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [onDismiss])
}
