// O `gifenc` (usado pra montar o avatar em GIF, ver lib/avatarGif.ts) não
// traz tipos. Declarado aqui só o pedaço que o app usa.
declare module 'gifenc' {
  export type Palette = number[][]
  export type ColorFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface WriteFrameOptions {
    palette?: Palette
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    repeat?: number
    dispose?: number
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void
    finish(): void
    bytes(): Uint8Array<ArrayBuffer>
  }

  export function GIFEncoder(): Encoder
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: ColorFormat; oneBitAlpha?: boolean | number }
  ): Palette
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: ColorFormat
  ): Uint8Array
}
