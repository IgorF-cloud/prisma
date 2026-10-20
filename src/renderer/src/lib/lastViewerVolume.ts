// Pedido do usuário (2026-09-30): o volume com que se assiste a uma live
// fica guardado NA MÁQUINA, do mesmo jeito que a Resolução + FPS da
// transmissão (ver lastTransmissionQuality.ts) — toda vez que o slider ou
// o botão de mudo é mexido, o valor novo é gravado, e a PRÓXIMA live em
// que a pessoa ENTRAR já começa nele. Vale inclusive pro volume 0 e pro
// mudo: se saiu mudo, a próxima abre muda.
//
// "Só quando ENTRAR" é a parte que importa: assistindo duas lives ao
// mesmo tempo, mexer no volume de uma NÃO mexe na outra — o volume vivo
// é por conexão (ver useViewer.ts), este arquivo é só a semente de quem
// está chegando agora.
//
// localStorage pelo mesmo motivo do lastTransmissionQuality.ts: é
// preferência de tela, por máquina, lida de forma SÍNCRONA no instante
// em que a conexão é criada — com IPC (assíncrono) a live começaria no
// volume padrão e pularia pro salvo um instante depois, que é
// exatamente o tipo de susto que se quer evitar com áudio.
const STORAGE_KEY = 'prisma:last-viewer-volume'

export interface ViewerVolume {
  volume: number
  muted: boolean
}

export const DEFAULT_VIEWER_VOLUME: ViewerVolume = { volume: 1, muted: false }

// Validação item a item (e não um `as ViewerVolume` no JSON.parse) pelo
// mesmo motivo do lastTransmissionQuality.ts: o que está no disco foi
// gravado por outra versão do app. Um `volume` fora de 0..1 (ou NaN) iria
// direto pro `HTMLAudioElement.volume`, que lança exceção — e a exceção
// cairia no meio do attach da track, deixando a live sem áudio nenhum.
export function loadLastViewerVolume(): ViewerVolume {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_VIEWER_VOLUME

    const saved = JSON.parse(raw) as Partial<ViewerVolume>
    const volume =
      typeof saved.volume === 'number' && Number.isFinite(saved.volume)
        ? Math.min(1, Math.max(0, saved.volume))
        : DEFAULT_VIEWER_VOLUME.volume
    return {
      volume,
      // Volume 0 é mudo por definição (é o que o slider faz, ver
      // useViewer.ts setVolume) — sem isso, um registro antigo com
      // volume 0 e muted false abriria a live "com som" num volume
      // inaudível, e o ícone mostraria o alto-falante ligado.
      muted: typeof saved.muted === 'boolean' ? saved.muted || volume === 0 : volume === 0
    }
  } catch (err) {
    // JSON corrompido ou localStorage indisponível. Cair no padrão é
    // melhor que impedir a pessoa de entrar na live.
    console.error('Não foi possível ler o último volume de espectador:', err)
    return DEFAULT_VIEWER_VOLUME
  }
}

export function saveLastViewerVolume(value: ViewerVolume): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch (err) {
    // Gravar é conveniência: se falhar, o volume DESTA live continua
    // valendo normalmente e só a próxima abre no padrão.
    console.error('Não foi possível salvar o último volume de espectador:', err)
  }
}
