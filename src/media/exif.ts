import WebP from 'node-webpmux';

export const STICKER_MAX_STATIC_BYTES = 100 * 1024;
export const STICKER_MAX_ANIMATED_BYTES = 500 * 1024;

export class StickerTooLargeError extends Error {
  constructor(sizeBytes: number, limitBytes: number) {
    const sizeKb = Math.ceil(sizeBytes / 1024);
    const limitKb = Math.floor(limitBytes / 1024);
    super(`Figurinha ficou muito pesada (${sizeKb} KB, limite ${limitKb} KB).`);
    this.name = 'StickerTooLargeError';
  }
}

export function buildWhatsAppExif(pack: string, author: string): Buffer {
  const payload = {
    'sticker-pack-id': 'com.wppstickerbot.pack',
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    emojis: [''],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  exifAttr.writeUInt32LE(jsonBuf.length, 14);
  return Buffer.concat([exifAttr, jsonBuf]);
}

export async function injectStickerExif(
  webpBuffer: Buffer,
  pack: string,
  author: string,
  animated: boolean,
): Promise<Buffer> {
  const img = new WebP.Image();
  await img.load(webpBuffer);
  img.exif = buildWhatsAppExif(pack, author);
  const result = await img.save(null);

  const limit = animated ? STICKER_MAX_ANIMATED_BYTES : STICKER_MAX_STATIC_BYTES;
  if (result.length > limit) {
    throw new StickerTooLargeError(result.length, limit);
  }

  return result;
}
