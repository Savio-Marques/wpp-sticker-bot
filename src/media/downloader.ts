import {
  downloadMediaMessage,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageContent,
  type WASocket,
} from '@whiskeysockets/baileys';
import type { Logger } from 'pino';

export type MediaKind = 'image' | 'video' | 'audio';

export interface MediaTarget {
  kind: MediaKind;
  message: WAMessage;
  fileLength?: number;
}

export type SoundStickerTarget =
  | { mode: 'video'; video: MediaTarget }
  | { mode: 'image+audio'; image: MediaTarget; audio: MediaTarget }
  | { mode: 'missing-audio' };

export class MediaTooLargeError extends Error {
  constructor(sizeBytes: number, maxMb: number) {
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
    super(`Mídia muito grande (${sizeMb} MB). O limite é ${maxMb} MB.`);
    this.name = 'MediaTooLargeError';
  }
}

export class UnsupportedMediaError extends Error {
  constructor(message = 'Nenhuma imagem, GIF ou vídeo encontrado.') {
    super(message);
    this.name = 'UnsupportedMediaError';
  }
}

export function unwrapMessage(content: WAMessageContent | null | undefined): WAMessageContent | undefined {
  let current = normalizeMessageContent(content);
  for (let i = 0; i < 4 && current; i += 1) {
    const next =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message;

    if (!next) break;
    current = normalizeMessageContent(next);
  }
  return current;
}

function parseFileLength(value: number | bigint | { toNumber(): number } | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return undefined;
}

function detectMediaContent(
  content: WAMessageContent | undefined,
  includeAudio = false,
): { kind: MediaKind; fileLength?: number } | null {
  if (!content) return null;
  if (content.imageMessage) {
    return {
      kind: 'image',
      fileLength: parseFileLength(content.imageMessage.fileLength),
    };
  }
  if (content.videoMessage) {
    return {
      kind: 'video',
      fileLength: parseFileLength(content.videoMessage.fileLength),
    };
  }
  if (includeAudio && content.audioMessage) {
    return {
      kind: 'audio',
      fileLength: parseFileLength(content.audioMessage.fileLength),
    };
  }
  return null;
}

function findQuotedContextInfo(content: WAMessageContent | undefined) {
  if (!content) return undefined;
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.stickerMessage?.contextInfo
  );
}

function buildQuotedWAMessage(
  msg: WAMessage,
  contextInfo: NonNullable<ReturnType<typeof findQuotedContextInfo>>,
  quotedContent: WAMessageContent,
): WAMessage {
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      id: contextInfo.stanzaId ?? undefined,
      participant: contextInfo.participant ?? undefined,
      fromMe: false,
    },
    message: quotedContent,
  };
}

export function extractMediaTarget(msg: WAMessage): MediaTarget | null {
  const ownContent = unwrapMessage(msg.message);
  const ownMedia = detectMediaContent(ownContent);
  if (ownMedia) {
    return {
      kind: ownMedia.kind,
      message: { ...msg, message: ownContent },
      fileLength: ownMedia.fileLength,
    };
  }

  const contextInfo = findQuotedContextInfo(ownContent);
  if (!contextInfo?.quotedMessage) {
    return null;
  }

  const quotedContent = unwrapMessage(contextInfo.quotedMessage);
  const quotedMedia = detectMediaContent(quotedContent);
  if (!quotedMedia) {
    return null;
  }

  return {
    kind: quotedMedia.kind,
    message: buildQuotedWAMessage(msg, contextInfo, quotedContent!),
    fileLength: quotedMedia.fileLength,
  };
}

export function extractSoundStickerTarget(msg: WAMessage): SoundStickerTarget | null {
  const ownContent = unwrapMessage(msg.message);
  const ownMedia = detectMediaContent(ownContent);

  const contextInfo = findQuotedContextInfo(ownContent);
  const quotedContent = contextInfo?.quotedMessage
    ? unwrapMessage(contextInfo.quotedMessage)
    : undefined;
  const quotedMedia = detectMediaContent(quotedContent, true);

  if (ownMedia?.kind === 'image' && quotedMedia?.kind === 'audio' && contextInfo && quotedContent) {
    return {
      mode: 'image+audio',
      image: {
        kind: 'image',
        message: { ...msg, message: ownContent },
        fileLength: ownMedia.fileLength,
      },
      audio: {
        kind: 'audio',
        message: buildQuotedWAMessage(msg, contextInfo, quotedContent),
        fileLength: quotedMedia.fileLength,
      },
    };
  }

  if (ownMedia?.kind === 'video') {
    return {
      mode: 'video',
      video: {
        kind: 'video',
        message: { ...msg, message: ownContent },
        fileLength: ownMedia.fileLength,
      },
    };
  }

  if (quotedMedia?.kind === 'video' && contextInfo && quotedContent) {
    return {
      mode: 'video',
      video: {
        kind: 'video',
        message: buildQuotedWAMessage(msg, contextInfo, quotedContent),
        fileLength: quotedMedia.fileLength,
      },
    };
  }

  if (ownMedia?.kind === 'image' || quotedMedia?.kind === 'image') {
    return { mode: 'missing-audio' };
  }

  return null;
}

export async function downloadValidatedMedia(
  target: MediaTarget,
  maxInputMb: number,
  sock: Pick<WASocket, 'updateMediaMessage'>,
  logger: Logger,
): Promise<Buffer> {
  const maxBytes = maxInputMb * 1024 * 1024;
  if (target.fileLength !== undefined && target.fileLength > maxBytes) {
    throw new MediaTooLargeError(target.fileLength, maxInputMb);
  }

  const buffer = await downloadMediaMessage(
    target.message,
    'buffer',
    {},
    {
      logger,
      reuploadRequest: sock.updateMediaMessage,
    },
  );

  if (buffer.length > maxBytes) {
    throw new MediaTooLargeError(buffer.length, maxInputMb);
  }

  return buffer;
}
