import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MessageSquare, MessageSquareOff, SendHorizontal } from 'lucide-react'
import { ChatMessage } from '../lib/useLiveChat'
import { AvatarRef } from '../lib/avatar'
import UserAvatar from './UserAvatar'

// Item 21 do roadmap: o corpo do chat da live — lista de mensagens +
// caixa de escrever. UM componente pros DOIS lugares (a ficha da sala,
// pro viewer; a aba do footer, pro host): o chat é o mesmo, o que muda é
// só a casca em volta e a moderação, que só o host recebe.
//
// Ele não sabe de sala, de IPC nem de rede — recebe mensagens e devolve
// texto. Quem fala com o servidor é o useLiveChat.ts.

// Pedido do usuário (2026-09-23). O servidor aceita até 500 (ver
// CHAT_MAX_LENGTH em chat.js) de propósito: o teto de lá é rede de
// segurança contra um cliente modificado, e ficar mais folgado permite
// mexer neste número aqui sem precisar subir o servidor de novo.
const MAX_LENGTH = 140

// A partir de quantos caracteres restantes o contador aparece. Mostrar
// "140" o tempo todo é ruído; o número só importa quando está perto.
const COUNTER_THRESHOLD = 20

interface LiveChatProps {
  messages: ChatMessage[]
  loading: boolean
  // Quem o host silenciou nesta sala, por nome. Serve pra duas coisas:
  // desenhar o botao no estado certo em cada mensagem e saber se EU fui
  // silenciado (comparando com `selfName`), pra desabilitar a caixa de
  // escrever em vez de deixar digitar e tomar 403 no envio.
  mutedNames: Set<string>
  userAvatars: Record<string, AvatarRef>
  apiBaseUrl: string
  // `false` quando o envio falhou — aí o texto FICA na caixa, pra pessoa
  // não perder o que escreveu.
  onSend: (text: string) => Promise<boolean>
  // --- moderação: só o host passa isto ---
  selfName: string
  onToggleMute?: (name: string, muted: boolean) => void
}

function LiveChat({
  messages,
  loading,
  mutedNames,
  userAvatars,
  apiBaseUrl,
  onSend,
  selfName,
  onToggleMute
}: LiveChatProps): React.JSX.Element {
  // Derivado, nao um estado proprio: uma fonte de verdade so.
  const muted = mutedNames.has(selfName)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLUListElement | null>(null)
  // A pessoa subiu a rolagem pra ler algo antigo? Então mensagem nova
  // NÃO arrasta a vista pro fim — puxar o texto embaixo do olho de quem
  // está lendo é a coisa mais irritante que um chat faz.
  const stickToBottomRef = useRef(true)

  function handleScroll(): void {
    const el = listRef.current
    if (!el) return
    // Folga de 24px: "praticamente no fim" conta como no fim, senão um
    // pixel de diferença (ou uma rolagem suave ainda terminando) já
    // desligaria o acompanhamento.
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  // `useLayoutEffect` e não `useEffect`: rola ANTES do navegador pintar,
  // senão a mensagem nova aparece por um quadro no lugar errado e a
  // vista "pula" depois.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    // Limpa OTIMISTA, e devolve o texto se o envio falhar. O contrário
    // (limpar só no sucesso) deixa a caixa cheia por um instante depois
    // do Enter, o que faz parecer que não funcionou e convida a mandar
    // de novo.
    setDraft('')
    const ok = await onSend(text)
    setSending(false)
    if (!ok) setDraft(text)
  }

  // Foco de volta na caixa depois de enviar — sem isto, mandar com o
  // BOTÃO tira o foco do campo e a pessoa tem que clicar de novo pra
  // continuar escrevendo.
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  const remaining = MAX_LENGTH - draft.length

  return (
    <div className="live-chat">
      <ul className="live-chat-messages" ref={listRef} onScroll={handleScroll}>
        {loading ? (
          <li className="live-chat-status">Carregando conversa...</li>
        ) : messages.length === 0 ? (
          <li className="live-chat-status">
            Ninguém falou nada ainda.
            <span className="live-chat-status-hint">Puxe assunto.</span>
          </li>
        ) : (
          messages.map((message) => {
            const canMute = Boolean(onToggleMute) && message.from !== selfName
            const alreadyMuted = mutedNames.has(message.from)
            return (
              <li key={message.id} className="live-chat-message">
                <span className="live-chat-avatar">
                  <UserAvatar
                    avatar={userAvatars[message.from]}
                    apiBaseUrl={apiBaseUrl}
                    size={12}
                  />
                </span>
                {/* Avatar + nome + ":" + mensagem num fluxo só, como
                    pedido — o texto quebra de linha sozinho e as linhas
                    seguintes alinham sob o nome, não sob o avatar. */}
                <p className="live-chat-text">
                  <span
                    className={
                      message.from === selfName
                        ? 'live-chat-author live-chat-author-self'
                        : 'live-chat-author'
                    }
                  >
                    {message.from}
                  </span>
                  <span className="live-chat-colon">:</span> {message.text}
                </p>
                {canMute && (
                  // Aparece só no hover da mensagem (ver o CSS) — o chat
                  // do host não pode virar uma coluna de botões.
                  <button
                    type="button"
                    className="live-chat-mute"
                    onClick={() => onToggleMute?.(message.from, !alreadyMuted)}
                    aria-label={
                      alreadyMuted
                        ? `Liberar ${message.from} no chat`
                        : `Silenciar ${message.from} no chat`
                    }
                    title={
                      alreadyMuted
                        ? `Liberar ${message.from} no chat`
                        : `Silenciar ${message.from} no chat`
                    }
                  >
                    {alreadyMuted ? <MessageSquare size={13} /> : <MessageSquareOff size={13} />}
                  </button>
                )}
              </li>
            )
          })
        )}
      </ul>

      <form
        className="live-chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSend()
        }}
      >
        <div className="live-chat-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="live-chat-input"
            // O limite é do próprio campo: não dá pra digitar nem colar
            // além disso, então não existe estado de "passou do limite".
            maxLength={MAX_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={muted ? 'Você foi silenciado nesta live' : 'Mensagem'}
            disabled={muted}
            aria-label="Escrever mensagem no chat"
          />
          {remaining <= COUNTER_THRESHOLD && !muted && (
            <span
              className={
                remaining === 0 ? 'live-chat-counter live-chat-counter-full' : 'live-chat-counter'
              }
            >
              {remaining}
            </span>
          )}
        </div>
        <button
          type="submit"
          className="live-chat-send"
          disabled={muted || sending || draft.trim().length === 0}
          aria-label="Enviar mensagem"
        >
          <SendHorizontal size={15} />
        </button>
      </form>
    </div>
  )
}

export default LiveChat
