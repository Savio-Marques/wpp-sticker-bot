import 'dotenv/config';
import fs from 'node:fs';

export interface AppConfig {
  phoneNumber?: string;
  ownerJid?: string;
  stickerPack: string;
  stickerAuthor: string;
  maxVideoSeconds: number;
  maxInputMb: number;
  maxConcurrentJobs: number;
  maxQueueSize: number;
  userCooldownMs: number;
  dataDir: string;
  healthPort: number;
  logLevel: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer, received "${raw}"`);
  }
  return parsed;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer, received "${raw}"`);
  }
  return parsed;
}

function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
}

function normalizeOwnerJid(raw: string | undefined): string | undefined {
  if (!raw || raw.trim() === '') return undefined;
  const trimmed = raw.trim();
  if (trimmed.includes('@')) {
    const [userPart, serverPart] = trimmed.split('@');
    const cleanUser = userPart.split(':')[0];
    return `${cleanUser}@${serverPart}`;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits.length > 0 ? `${digits}@s.whatsapp.net` : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    phoneNumber: normalizePhone(env.PHONE_NUMBER),
    ownerJid: normalizeOwnerJid(env.OWNER_JID),
    stickerPack: env.STICKER_PACK?.trim() || 'Sticker Bot',
    stickerAuthor: env.STICKER_AUTHOR?.trim() || 'WhatsApp Bot',
    maxVideoSeconds: parsePositiveInt(env.MAX_VIDEO_SECONDS, 7, 'MAX_VIDEO_SECONDS'),
    maxInputMb: parsePositiveInt(env.MAX_INPUT_MB, 25, 'MAX_INPUT_MB'),
    maxConcurrentJobs: parsePositiveInt(env.MAX_CONCURRENT_JOBS, 2, 'MAX_CONCURRENT_JOBS'),
    maxQueueSize: parsePositiveInt(env.MAX_QUEUE_SIZE, 20, 'MAX_QUEUE_SIZE'),
    userCooldownMs: parseNonNegativeInt(env.USER_COOLDOWN_MS, 5000, 'USER_COOLDOWN_MS'),
    dataDir: env.DATA_DIR?.trim() || './data',
    healthPort: parsePositiveInt(env.HEALTH_PORT, 8080, 'HEALTH_PORT'),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  };
}

export async function resolveFfmpegPath(envPath?: string): Promise<string> {
  if (envPath && envPath.trim() !== '') {
    return envPath.trim();
  }

  if (fs.existsSync('/usr/bin/ffmpeg')) {
    return '/usr/bin/ffmpeg';
  }

  try {
    const mod = await import('ffmpeg-static');
    const staticPath = (mod.default ?? mod) as unknown;
    if (typeof staticPath === 'string' && staticPath.length > 0 && fs.existsSync(staticPath)) {
      return staticPath;
    }
  } catch {
    // ffmpeg-static is a devDependency; production container uses system ffmpeg
  }

  return 'ffmpeg';
}
