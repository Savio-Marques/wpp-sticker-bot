import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { injectStickerExif, StickerTooLargeError, STICKER_MAX_ANIMATED_BYTES } from './exif.js';

const execFileAsync = promisify(execFile);

const MAX_PRE_EXIF_BYTES = 490 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;

interface CompressionProfile {
  fps: number;
  quality: number;
  duration: number;
}

function buildProfiles(maxDurationSec: number): CompressionProfile[] {
  return [
    { fps: 15, quality: 65, duration: maxDurationSec },
    { fps: 12, quality: 50, duration: maxDurationSec },
    { fps: 10, quality: 35, duration: Math.min(maxDurationSec, 6) },
    { fps: 8, quality: 25, duration: Math.min(maxDurationSec, 5) },
  ];
}

export async function convertVideoToSticker(
  input: Buffer,
  opts: { pack: string; author: string; maxDurationSec: number; ffmpegPath: string },
): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-sticker-'));
  const inputPath = path.join(tmpDir, 'input.mp4');
  const outputPath = path.join(tmpDir, 'output.webp');

  try {
    await fs.writeFile(inputPath, input);

    const profiles = buildProfiles(opts.maxDurationSec);
    let lastSize = 0;

    for (const profile of profiles) {
      const vf = `crop=min(iw\\,ih):min(iw\\,ih),scale=512:512:flags=lanczos,fps=${profile.fps}`;
      await execFileAsync(
        opts.ffmpegPath,
        [
          '-y',
          '-i',
          inputPath,
          '-t',
          String(profile.duration),
          '-vf',
          vf,
          '-vcodec',
          'libwebp',
          '-loop',
          '0',
          '-preset',
          'default',
          '-an',
          '-vsync',
          '0',
          '-compression_level',
          '6',
          '-q:v',
          String(profile.quality),
          '-threads',
          '2',
          outputPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS },
      );

      const webpBuf = await fs.readFile(outputPath);
      lastSize = webpBuf.length;

      if (webpBuf.length <= MAX_PRE_EXIF_BYTES) {
        return await injectStickerExif(webpBuf, opts.pack, opts.author, true);
      }
    }

    throw new StickerTooLargeError(lastSize, STICKER_MAX_ANIMATED_BYTES);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
