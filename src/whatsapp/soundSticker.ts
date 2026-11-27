import {
  generateMessageIDV2,
  prepareWAMessageMedia,
  proto,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import type { Logger } from 'pino';

const soundStickerAudioMap = new WeakMap<
  proto.Message.IStickerMessage,
  proto.Message.IAudioMessage
>();

let encoderPatched = false;

export function encodeVarint(n: number): Buffer {
  const bytes: number[] = [];
  let value = n >>> 0;
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

export function encodeVarintField(fieldNum: number, value: number): Buffer {
  return Buffer.concat([encodeVarint((fieldNum << 3) | 0), encodeVarint(value)]);
}

export function encodeBytesField(fieldNum: number, payload: Uint8Array): Buffer {
  return Buffer.concat([
    encodeVarint((fieldNum << 3) | 2),
    encodeVarint(payload.length),
    Buffer.from(payload),
  ]);
}

export function registerSoundStickerAudio(
  stickerMessage: proto.Message.IStickerMessage,
  audioMessage: proto.Message.IAudioMessage,
): void {
  soundStickerAudioMap.set(stickerMessage, audioMessage);
}

export function buildSoundStickerFutureProofBytes(
  stickerMessage: proto.Message.IStickerMessage,
  audioMessage: proto.Message.IAudioMessage,
): Buffer {
  const stickerBase = proto.Message.StickerMessage.encode(stickerMessage).finish();
  const audioBytes = proto.Message.AudioMessage.encode(audioMessage).finish();
  const stickerWithAudio = Buffer.concat([
    stickerBase,
    encodeVarintField(24, 0),
    encodeBytesField(26, audioBytes),
  ]);
  const innerMessage = encodeBytesField(26, stickerWithAudio);
  return encodeBytesField(1, innerMessage);
}

export function patchSoundStickerEncoder(): void {
  if (encoderPatched) return;

  const originalEncode = proto.Message.encode.bind(proto.Message);
  proto.Message.encode = function patchedMessageEncode(message, writer) {
    const stickerMsg = message?.stickerMessage;
    const audioMsg = stickerMsg ? soundStickerAudioMap.get(stickerMsg) : undefined;

    if (!stickerMsg || !audioMsg) {
      return originalEncode(message, writer);
    }

    const sanitized: proto.IMessage = { ...message, stickerMessage: undefined };
    const outWriter = originalEncode(sanitized, writer);
    const futureProofBytes = buildSoundStickerFutureProofBytes(stickerMsg, audioMsg);
    outWriter.uint32((134 << 3) | 2).bytes(futureProofBytes);
    return outWriter;
  };

  encoderPatched = true;
}

export interface SendSoundStickerOptions {
  webp: Buffer;
  isAnimated: boolean;
  ogg: Buffer;
  seconds: number;
  quoted?: WAMessage;
  logger: Logger;
  onMessageId?: (id: string) => void;
}

export async function sendSoundSticker(
  sock: WASocket,
  jid: string,
  opts: SendSoundStickerOptions,
): Promise<string> {
  patchSoundStickerEncoder();

  const durationSec = Math.max(1, Math.round(opts.seconds));
  const mediaOpts = { upload: sock.waUploadToServer, logger: opts.logger };

  const [{ stickerMessage }, { audioMessage }] = await Promise.all([
    prepareWAMessageMedia({ sticker: opts.webp }, mediaOpts),
    prepareWAMessageMedia(
      { audio: opts.ogg, mimetype: 'audio/ogg; codecs=opus', seconds: durationSec },
      mediaOpts,
    ),
  ]);

  if (!stickerMessage || !audioMessage) {
    throw new Error('Falha ao preparar mídia da figurinha com som.');
  }

  stickerMessage.mimetype = 'image/webp';
  stickerMessage.width = 512;
  stickerMessage.height = 512;
  stickerMessage.isAnimated = opts.isAnimated;
  stickerMessage.stickerSentTs = Date.now();

  if (opts.quoted?.key?.id) {
    const quotedParticipant =
      opts.quoted.key.participant ??
      (opts.quoted.key.fromMe ? sock.user?.id : opts.quoted.key.remoteJid) ??
      undefined;
    stickerMessage.contextInfo = {
      stanzaId: opts.quoted.key.id,
      participant: quotedParticipant,
      quotedMessage: opts.quoted.message ?? undefined,
    };
  }

  audioMessage.mimetype = 'audio/ogg; codecs=opus';
  audioMessage.ptt = false;
  audioMessage.seconds = durationSec;

  registerSoundStickerAudio(stickerMessage, audioMessage);

  const messageId = generateMessageIDV2(sock.user?.id);
  opts.onMessageId?.(messageId);

  await sock.relayMessage(jid, { stickerMessage }, { messageId });
  return messageId;
}
