import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolveFfmpegPath } from '../src/config/env.js';
import {
  convertAudioToStickerOpus,
  NoAudioTrackError,
  STICKER_MAX_AUDIO_BYTES,
} from '../src/media/audioConverter.js';

const execFileAsync = promisify(execFile);

describe('convertAudioToStickerOpus', () => {
  it('extracts and trims audio from 12s video to OGG/Opus <= 7s and <= 900 KB', async () => {
    const ffmpegPath = await resolveFfmpegPath();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-aud-test-'));
    const videoPath = path.join(tmpDir, 'with-audio.mp4');

    try {
      await execFileAsync(ffmpegPath, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=12:size=320x240:rate=15',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=12',
        '-pix_fmt',
        'yuv420p',
        '-shortest',
        videoPath,
      ]);

      const input = await fs.readFile(videoPath);
      const result = await convertAudioToStickerOpus(input, {
        maxDurationSec: 7,
        ffmpegPath,
      });

      expect(result.buffer.subarray(0, 4).toString('ascii')).toBe('OggS');
      expect(result.seconds).toBeGreaterThanOrEqual(1);
      expect(result.seconds).toBeLessThanOrEqual(7);
      expect(result.buffer.length).toBeLessThanOrEqual(STICKER_MAX_AUDIO_BYTES);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws NoAudioTrackError when video has no audio stream', async () => {
    const ffmpegPath = await resolveFfmpegPath();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-noaud-test-'));
    const videoPath = path.join(tmpDir, 'silent.mp4');

    try {
      await execFileAsync(ffmpegPath, [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=320x240:rate=15',
        '-an',
        '-pix_fmt',
        'yuv420p',
        videoPath,
      ]);

      const input = await fs.readFile(videoPath);
      await expect(
        convertAudioToStickerOpus(input, { maxDurationSec: 7, ffmpegPath }),
      ).rejects.toBeInstanceOf(NoAudioTrackError);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
