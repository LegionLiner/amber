import { desktop } from './bridge'

/**
 * Файл на диске компьютера для веб-движка: ведёт себя как браузерный File (размер, slice().arrayBuffer()),
 * но байты читает по запросу через главный процесс. Разбор тегов просит десятки килобайт, а не весь файл.
 */
export class DesktopFile {
  readonly type = ''

  constructor(
    readonly path: string,
    readonly name: string,
    readonly size: number,
    readonly lastModified: number,
  ) {}

  slice(start = 0, end = this.size): { arrayBuffer(): Promise<ArrayBuffer> } {
    const s = Math.max(0, start < 0 ? this.size + start : start)
    const e = Math.min(this.size, end < 0 ? this.size + end : end)
    return {
      arrayBuffer: async () => {
        if (e <= s) return new ArrayBuffer(0)
        const u8 = await desktop!.read(this.path, s, e)
        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
      },
    }
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.slice(0, this.size).arrayBuffer()
  }
}
