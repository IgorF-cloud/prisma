import { applyPalette, GIFEncoder, quantize } from 'gifenc'

// Avatar em GIF (2026-10-19, pedido do usuário).
//
// Mesma decisão da foto parada (lib/avatar.ts): o CLIENTE prepara tudo e
// o servidor só grava — nada de biblioteca de imagem lá. Daqui saem DOIS
// arquivos, enviados juntos:
//
//   - o GIF animado, recortado no quadrado central e reduzido;
//   - uma cópia PARADA em WebP 96x96 (o primeiro quadro), que é o que as
//     versões antigas do app — que só conhecem `/avatars/<id>.webp` —
//     continuam mostrando.
//
// Recodificar em vez de mandar o GIF original: GIFs de reação costumam
// ter de 2 a 8 MB, e o avatar é baixado por todo mundo que vê a pessoa
// numa lista. Reduzido pro tamanho em que ele aparece, fica em dezenas
// ou poucas centenas de kB.
//
// Os quadros vêm do `ImageDecoder` (WebCodecs, nativo do Chromium), que
// já entrega cada quadro COMPOSTO — o GIF de origem pode desenhar só o
// pedaço que mudou, e aqui não é preciso remontar nada.

// Lado do GIF. Maior que os 96 da foto parada porque é o arquivo que a
// janela de perfil mostra a 104px; 128 cobre isso sem ficar pesado.
// Se o resultado passar do teto, tenta de novo menor (ver abaixo).
const GIF_SIZES = [128, 96]
const STATIC_SIZE = 96

// Teto do arquivo final. O servidor aceita 4 MB no corpo inteiro (GIF +
// cópia parada); fica uma folga pra cópia.
const MAX_GIF_BYTES = 3.5 * 1024 * 1024
// Teto do arquivo ESCOLHIDO, antes de qualquer processamento: decodificar
// um GIF enorme quadro a quadro pode travar a janela por segundos.
const MAX_SOURCE_BYTES = 20 * 1024 * 1024
// Acima disso, pula quadros (somando o tempo deles no que fica), pra
// animação manter a mesma duração com menos quadros.
const MAX_FRAMES = 150
// Navegadores tratam atraso abaixo de 20ms como 100ms — um GIF "rápido
// demais" acabaria lento. 20ms é o menor que todos respeitam.
const MIN_DELAY_MS = 20

export interface AnimatedAvatarFiles {
  webp: Blob
  gif: Blob
}

export function isGifFile(file: File): boolean {
  return file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')
}

// `null` quando o GIF tem um quadro só — aí ele é uma foto como outra
// qualquer, e quem chamou segue pelo caminho da foto parada.
export async function prepareAnimatedAvatar(file: File): Promise<AnimatedAvatarFiles | null> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Esse GIF é grande demais. Escolha um arquivo de até 20 MB.')
  }
  if (typeof ImageDecoder === 'undefined') {
    throw new Error('Este navegador não consegue processar GIFs animados.')
  }

  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' })
  try {
    // As DUAS esperas, e nesta ordem (corrigido em 2026-10-19). Com os
    // dados num buffer, `completed` resolve na hora, antes de o Chromium
    // ler o cabeçalho do GIF — e aí `selectedTrack` ainda é `null`. Era o
    // que fazia todo GIF cair no `?? 1`, ser tratado como foto de um
    // quadro e subir parado, sem erro nenhum. Quem avisa que as faixas
    // existem é `tracks.ready`; `completed` garante depois que o
    // `frameCount` já é o final, e não o parcial.
    await decoder.tracks.ready
    await decoder.completed
    const track = decoder.tracks.selectedTrack
    // Sem faixa é erro, não "um quadro só": cair em silêncio na foto
    // parada foi justamente o que escondeu o defeito acima.
    if (!track) throw new Error('Não foi possível ler esse GIF.')
    const frameCount = track.frameCount
    if (frameCount <= 1) return null

    const webp = await encodeStaticFrame(decoder)

    for (const size of GIF_SIZES) {
      const gif = await encodeGif(decoder, frameCount, size)
      if (gif.size <= MAX_GIF_BYTES) return { webp, gif }
    }
    throw new Error('Esse GIF tem quadros demais para virar avatar. Tente um mais curto.')
  } finally {
    decoder.close()
  }
}

// Recorte central quadrado, igual ao da foto parada — `cover`, não
// esticar.
function drawCover(ctx: CanvasRenderingContext2D, frame: VideoFrame, size: number): void {
  const width = frame.displayWidth
  const height = frame.displayHeight
  const side = Math.min(width, height)
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(frame, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size)
}

function makeCanvas(size: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  // `willReadFrequently`: cada quadro é lido de volta com getImageData,
  // e sem a dica o Chromium faria isso pela GPU, bem mais devagar.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Não foi possível processar o GIF.')
  return ctx
}

async function encodeStaticFrame(decoder: ImageDecoder): Promise<Blob> {
  const ctx = makeCanvas(STATIC_SIZE)
  const { image } = await decoder.decode({ frameIndex: 0 })
  drawCover(ctx, image, STATIC_SIZE)
  image.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    ctx.canvas.toBlob(resolve, 'image/webp', 0.9)
  )
  if (!blob) throw new Error('Não foi possível processar o GIF.')
  return blob
}

async function encodeGif(decoder: ImageDecoder, frameCount: number, size: number): Promise<Blob> {
  const ctx = makeCanvas(size)
  const encoder = GIFEncoder()
  const step = Math.ceil(frameCount / MAX_FRAMES)

  for (let start = 0; start < frameCount; start += step) {
    // O quadro que fica herda o tempo dos que foram pulados — a
    // animação dura o mesmo, só com menos quadros.
    let delayMs = 0
    let kept: VideoFrame | null = null
    for (let i = start; i < Math.min(start + step, frameCount); i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      // `duration` vem em microssegundos.
      delayMs += (image.duration ?? 100_000) / 1000
      if (kept) image.close()
      else kept = image
    }
    if (!kept) continue

    drawCover(ctx, kept, size)
    kept.close()

    const { data } = ctx.getImageData(0, 0, size, size)
    // `rgba4444` + `oneBitAlpha`: mantém a transparência do GIF (ou ele
    // ganharia um fundo preto dentro do círculo).
    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true })
    const index = applyPalette(data, palette, 'rgba4444')
    const transparentIndex = palette.findIndex((color) => color[3] === 0)

    encoder.writeFrame(index, size, size, {
      palette,
      delay: Math.max(MIN_DELAY_MS, Math.round(delayMs)),
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      // 2 = limpa antes do próximo quadro. Cada quadro aqui já é a imagem
      // INTEIRA, e sem limpar as partes transparentes acumulariam o
      // desenho dos quadros anteriores.
      dispose: 2
    })
  }

  encoder.finish()
  return new Blob([encoder.bytes()], { type: 'image/gif' })
}
