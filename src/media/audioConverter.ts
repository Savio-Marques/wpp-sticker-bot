import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const STICKER_MAX_AUDIO_BYTES = 900 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;
const BITRATE_STEPS = ['32k', '20k'] as const;

export class NoAudioTrackError extends Error {
  constructor() {
    super('Esse vídeo não tem áudio. Use `!fig` para criar uma figurinha sem som.');
    this.name = 'NoAudioTrackError';
  }
}

export class AudioTooLargeError extends Error {
  constructor(sizeBytes: number, limitBytes: number) {
    const sizeKb = Math.ceil(sizeBytes / 1024);
    const limitKb = Math.floor(limitBytes / 1024);
    super(`Áudio ficou muito pesado (${sizeKb} KB, limite ${limitKb} KB).`);
    this.name = 'AudioTooLargeError';
  }
}

function parseDurationFromFfmpegStderr(stderr: string, maxDurationSec: number): number {
  const matches = Array.from(stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g));
  if (matches.length === 0) return maxDurationSec;
  const last = matches[matches.length - 1];
  const hours = Number.parseInt(last[1], 10);
  const minutes = Number.parseInt(last[2], 10);
  const secs = Number.parseFloat(last[3]);
  const total = hours * 3600 + minutes * 60 + secs;
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.min(maxDurationSec, Math.round(total)));
}

export async function convertAudioToStickerOpus(
  input: Buffer,
  opts: { maxDurationSec: number; ffmpegPath: string },
): Promise<{ buffer: Buffer; seconds: number }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-audio-'));
  const inputPath = path.join(tmpDir, 'input.bin');
  const outputPath = path.join(tmpDir, 'output.ogg');

  try {
    await fs.writeFile(inputPath, input);

    let lastSize = 0;

    for (const bitrate of BITRATE_STEPS) {
      let stderr = '';
      try {
        const res = await execFileAsync(
          opts.ffmpegPath,
          [
            '-y',
            '-i',
            inputPath,
            '-t',
            String(opts.maxDurationSec),
            '-vn',
            '-map',
            '0:a:0',
            '-c:a',
            'libopus',
            '-ac',
            '1',
            '-ar',
            '48000',
            '-b:a',
            bitrate,
            '-application',
            'voip',
            '-f',
            'ogg',
            outputPath,
          ],
          { timeout: FFMPEG_TIMEOUT_MS },
        );
        stderr = res.stderr ?? '';
      } catch (error) {
        const err = error as { stderr?: string };
        const msg = err.stderr ?? '';
        if (/Stream map.*matches no streams|does not contain any stream/i.test(msg)) {
          throw new NoAudioTrackError();
        }
        throw error;
      }

      const buffer = await fs.readFile(outputPath);
      lastSize = buffer.length;

      if (buffer.length <= STICKER_MAX_AUDIO_BYTES) {
        const seconds = parseDurationFromFfmpegStderr(stderr, opts.maxDurationSec);
        return { buffer, seconds };
      }
    }

    throw new AudioTooLargeError(lastSize, STICKER_MAX_AUDIO_BYTES);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
