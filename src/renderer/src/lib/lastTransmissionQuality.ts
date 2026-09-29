import { Fps, FPS_OPTIONS, Resolution, RESOLUTIONS } from './transmissionSettings'

// Pedido do usuário (2026-09-25): a combinação Resolução + FPS escolhida
// na TransmissionScreen fica guardada NA MÁQUINA e volta pré-selecionada
// na próxima vez que a pessoa for abrir uma live. Só grava quando a live
// realmente ENTRA NO AR — mexer nos pills e desistir (ou uma falha ao
// iniciar) não muda nada, senão a memória viraria "no que eu cliquei por
// último" em vez de "com o que eu transmiti por último".
//
// Por que localStorage e não um JSON em `userData` via IPC, como
// session.ts/gameDetectableCache.ts fazem: aqueles precisam do main
// (token cifrado pela DPAPI, download em background antes da janela
// existir). Isto aqui é preferência de TELA, lida uma vez na montagem do
// componente — o localStorage do renderer já é por máquina, persiste
// entre aberturas do app e é SÍNCRONO, então os pills já nascem com o
// valor certo. Com IPC (assíncrono) eles apareceriam no padrão e
// pulariam pro valor salvo um instante depois.
//
// NÃO guarda a fonte de captura (o id de um monitor/janela não
// sobrevive a um reboot nem a fechar o jogo) nem o "Transmissão
// privada" — o pedido foi só qualidade, e privacidade é uma decisão que
// merece ser tomada de novo a cada live.
const STORAGE_KEY = 'prisma:last-transmission-quality'

export interface TransmissionQuality {
  resolution: Resolution
  fps: Fps
}

export const DEFAULT_QUALITY: TransmissionQuality = { resolution: '1080p', fps: 30 }

// Validação item a item (e não um `as TransmissionQuality` no JSON.parse)
// porque o que está no disco foi gravado por uma VERSÃO ANTERIOR do app:
// se uma opção for renomeada ou sair da lista, o valor velho continua lá.
// Sem isto, o app abriria com um pill que não existe mais — nenhum
// botão aceso e um valor inválido indo parar no pipeline do GStreamer.
export function loadLastQuality(): TransmissionQuality {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_QUALITY

    const saved = JSON.parse(raw) as Partial<TransmissionQuality>
    return {
      resolution: RESOLUTIONS.includes(saved.resolution as Resolution)
        ? (saved.resolution as Resolution)
        : DEFAULT_QUALITY.resolution,
      fps: FPS_OPTIONS.includes(saved.fps as Fps) ? (saved.fps as Fps) : DEFAULT_QUALITY.fps
    }
  } catch (err) {
    // JSON corrompido ou localStorage indisponível. Cair no padrão é
    // muito melhor que quebrar a tela de configuração inteira.
    console.error('Não foi possível ler a última qualidade de transmissão:', err)
    return DEFAULT_QUALITY
  }
}

export function saveLastQuality(quality: TransmissionQuality): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quality))
  } catch (err) {
    // Gravar é conveniência: se falhar, a live já começou e a única
    // consequência é a próxima abrir no padrão.
    console.error('Não foi possível salvar a última qualidade de transmissão:', err)
  }
}
