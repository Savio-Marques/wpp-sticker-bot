import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import WebP from 'node-webpmux';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { resolveFfmpegPath } from '../src/config/env.js';
import { STICKER_MAX_ANIMATED_BYTES } from '../src/media/exif.js';
import { convertVideoToSticker } from '../src/media/videoConverter.js';

const execFileAsync = promisify(execFile);

describe('convertVideoToSticker', () => {
  it('trims 12s rectangular video to <=7s, 512x512 animated WebP <= 500 KB with EXIF', async () => {
    const ffmpegPath = await resolveFfmpegPath();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-vid-test-'));
    const videoPath = path.join(tmpDir, 'sample.mp4');

    try {
      await execFileAsync(ffmpegPath, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=12:size=1280x720:rate=25',
        '-pix_fmt',
        'yuv420p',
        videoPath,
      ]);

      const inputVideo = await fs.readFile(videoPath);
      const sticker = await convertVideoToSticker(inputVideo, {
        pack: 'Anim Pack',
        author: 'Anim Author',
        maxDurationSec: 7,
        ffmpegPath,
      });

      expect(sticker.length).toBeLessThanOrEqual(STICKER_MAX_ANIMATED_BYTES);

      const meta = await sharp(sticker, { animated: true }).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(512);
      expect(meta.pageHeight ?? meta.height).toBe(512);
      expect((meta.pages ?? 1) > 1).toBe(true);

      const totalDurationMs = (meta.delay ?? []).reduce((sum, d) => sum + d, 0);
      expect(totalDurationMs).toBeGreaterThan(0);
      expect(totalDurationMs).toBeLessThanOrEqual(7500);

      const img = new WebP.Image();
      await img.load(sticker);
      expect(img.hasAnim).toBe(true);
      expect(img.exif).toBeDefined();
      const exifText = img.exif!.toString('utf8');
      expect(exifText).toContain('Anim Pack');
      expect(exifText).toContain('Anim Author');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
