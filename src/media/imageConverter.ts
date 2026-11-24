import sharp from 'sharp';
import { injectStickerExif } from './exif.js';

const MAX_PRE_EXIF_BYTES = 95 * 1024;
const QUALITY_STEPS = [80, 65, 50, 35];

export async function convertImageToSticker(
  input: Buffer,
  opts: { pack: string; author: string },
): Promise<Buffer> {
  let encoded: Buffer | undefined;

  for (const quality of QUALITY_STEPS) {
    const candidate = await sharp(input)
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality })
      .toBuffer();

    encoded = candidate;
    if (candidate.length <= MAX_PRE_EXIF_BYTES) {
      break;
    }
  }

  return injectStickerExif(encoded!, opts.pack, opts.author, false);
}
