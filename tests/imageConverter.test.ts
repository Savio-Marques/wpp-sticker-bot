import WebP from 'node-webpmux';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { STICKER_MAX_STATIC_BYTES } from '../src/media/exif.js';
import { convertImageToSticker } from '../src/media/imageConverter.js';

describe('convertImageToSticker', () => {
  it('crops rectangular image to 512x512 WebP <= 100 KB with EXIF pack/author', async () => {
    const inputPng = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 4,
        background: { r: 220, g: 80, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const sticker = await convertImageToSticker(inputPng, {
      pack: 'Pack Teste',
      author: 'Autor Teste',
    });

    expect(sticker.length).toBeLessThanOrEqual(STICKER_MAX_STATIC_BYTES);

    const meta = await sharp(sticker).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);

    const img = new WebP.Image();
    await img.load(sticker);
    expect(img.exif).toBeDefined();
    const exifText = img.exif!.toString('utf8');
    expect(exifText).toContain('Pack Teste');
    expect(exifText).toContain('Autor Teste');
  });
});
