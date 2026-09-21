import { app } from 'electron'
import { logGstreamer } from './gstreamerLog'

// Ícone do programa cuja janela está sendo transmitida (2026-09-14,
// pedido do usuário).
//
// Serve pros dois lados de uma vez: o quadradinho no rodapé de quem
// transmite e a ficha da sala pra quem assiste. É o mesmo campo
// `iconUrl` que já carregava a arte de jogo vinda do CDN do Discord —
// por isso vai embutido como `data:image/png;base64,...` em vez de um
// link: não existe servidor nosso pra hospedar o ícone de um .exe que só
// existe na máquina de quem transmite.
//
// `app.getFileIcon` é a API do Electron pra isso, e é nativa: pede o
// ícone ao próprio Windows (o mesmo que aparece no Explorer). A
// alternativa seria extrair do executável via PowerShell — mais lento,
// mais código, e com o problema extra de processos protegidos.
//
// 'large' = 48x48 no Windows. O quadrado do rodapé tem 42px, então 32
// ('normal') apareceria borrado e 48 desce limpo.

// Teto do data URL. Um ícone de 48px dá uns 3-6KB; acima disso tem
// alguma coisa estranha (um .exe com um ícone gigante embutido), e não
// vale a pena carregar isso em TODO broadcast de salas pra todo mundo —
// melhor cair no desenho de placeholder.
const MAX_DATA_URL_LENGTH = 24_000

// Por CAMINHO do executável, não por janela: o ícone é do programa, e
// duas janelas do mesmo programa têm o mesmo. Guarda também os `null`
// (falhou/não tem), pra não tentar de novo a cada troca de janela.
//
// Nunca é limpo de propósito: são poucas dezenas de entradas na vida de
// uma sessão do app, e o custo de lembrar é menor que o de refazer.
const cache = new Map<string, string | null>()

export async function getWindowIconDataUrl(processPath?: string | null): Promise<string | null> {
  if (!processPath) return null

  const cached = cache.get(processPath)
  if (cached !== undefined) return cached

  let result: string | null = null
  try {
    const icon = await app.getFileIcon(processPath, { size: 'large' })
    // `isEmpty` cobre o caso de o Windows devolver um ícone vazio em vez
    // de falhar — aí o data URL seria um PNG transparente de 48x48, que
    // na tela é um buraco.
    if (!icon.isEmpty()) {
      const dataUrl = icon.toDataURL()
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) {
        result = dataUrl
      } else {
        logGstreamer(
          `ícone de ${processPath} ignorado: ${dataUrl.length} caracteres (teto ${MAX_DATA_URL_LENGTH})`
        )
      }
    }
  } catch (err) {
    // Executável protegido, caminho de rede que sumiu, permissão. Não é
    // erro de verdade: a transmissão segue com o placeholder.
    logGstreamer(`não consegui ler o ícone de ${processPath}: ${err}`)
  }

  cache.set(processPath, result)
  return result
}
