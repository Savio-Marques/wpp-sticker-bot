import { proto } from '@whiskeysockets/baileys';
import { describe, expect, it } from 'vitest';
import {
  patchSoundStickerEncoder,
  registerSoundStickerAudio,
} from '../src/whatsapp/soundSticker.js';

interface WireField {
  field: number;
  wireType: number;
  varint?: number;
  bytes?: Uint8Array;
}

function readVarint(buf: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: pos };
    shift += 7;
  }
  throw new Error('Truncated varint');
}

function parseWireFields(buf: Uint8Array): WireField[] {
  const fields: WireField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    pos = tag.next;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x7;

    if (wireType === 0) {
      const val = readVarint(buf, pos);
      pos = val.next;
      fields.push({ field, wireType, varint: val.value });
    } else if (wireType === 2) {
      const len = readVarint(buf, pos);
      pos = len.next;
      const bytes = buf.subarray(pos, pos + len.value);
      pos += len.value;
      fields.push({ field, wireType, bytes });
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      throw new Error(`Unsupported wireType ${wireType}`);
    }
  }
  return fields;
}

describe('soundSticker protobuf encoder', () => {
  it('rewrites registered stickerMessage into field 134 -> 1 -> 26 with field 24=0 and field 26=audioMessage', () => {
    patchSoundStickerEncoder();

    const stickerMessage: proto.Message.IStickerMessage = {
      url: 'https://mmg.whatsapp.net/sticker',
      mimetype: 'image/webp',
      width: 512,
      height: 512,
      isAnimated: true,
      mediaKey: new Uint8Array(32).fill(1),
    };
    const audioMessage: proto.Message.IAudioMessage = {
      url: 'https://mmg.whatsapp.net/test',
      mimetype: 'audio/ogg; codecs=opus',
      ptt: false,
      seconds: 5,
      mediaKey: new Uint8Array(32).fill(2),
    };

    registerSoundStickerAudio(stickerMessage, audioMessage);

    const encodedRoot = proto.Message.encode({ stickerMessage }).finish();
    const rootFields = parseWireFields(encodedRoot);

    expect(rootFields.some((f) => f.field === 26)).toBe(false);
    const f134 = rootFields.find((f) => f.field === 134 && f.wireType === 2);
    expect(f134?.bytes).toBeDefined();

    const futureProofFields = parseWireFields(f134!.bytes!);
    const f1 = futureProofFields.find((f) => f.field === 1 && f.wireType === 2);
    expect(f1?.bytes).toBeDefined();

    const innerMsgFields = parseWireFields(f1!.bytes!);
    const f26 = innerMsgFields.find((f) => f.field === 26 && f.wireType === 2);
    expect(f26?.bytes).toBeDefined();

    const decodedSticker = proto.Message.StickerMessage.decode(f26!.bytes!);
    expect(decodedSticker.url).toBe('https://mmg.whatsapp.net/sticker');
    expect(decodedSticker.mimetype).toBe('image/webp');
    expect(decodedSticker.width).toBe(512);
    expect(decodedSticker.height).toBe(512);
    expect(decodedSticker.isAnimated).toBe(true);

    const stickerFields = parseWireFields(f26!.bytes!);
    const f24 = stickerFields.find((f) => f.field === 24 && f.wireType === 0);
    expect(f24?.varint).toBe(0);

    const nestedAudio = stickerFields.find((f) => f.field === 26 && f.wireType === 2);
    expect(nestedAudio?.bytes).toBeDefined();
    const decodedAudio = proto.Message.AudioMessage.decode(nestedAudio!.bytes!);
    expect(decodedAudio.mimetype).toBe('audio/ogg; codecs=opus');
    expect(decodedAudio.ptt).toBe(false);
    expect(decodedAudio.seconds).toBe(5);
    expect(decodedAudio.url).toBe('https://mmg.whatsapp.net/test');

    // Verify deviceSentMessage nesting also routes through patched proto.Message.encode
    const dsmBytes = proto.Message.encode({
      deviceSentMessage: {
        destinationJid: '5511999999999@s.whatsapp.net',
        message: { stickerMessage },
      },
    }).finish();
    const dsmRoot = proto.Message.decode(dsmBytes);
    expect(dsmRoot.deviceSentMessage?.destinationJid).toBe('5511999999999@s.whatsapp.net');
    const dsmRawFields = parseWireFields(dsmBytes);
    const dsmField31 = dsmRawFields.find((f) => f.field === 31 && f.wireType === 2);
    const dsmInnerFields = parseWireFields(dsmField31!.bytes!);
    const dsmMsgField2 = dsmInnerFields.find((f) => f.field === 2 && f.wireType === 2);
    const dsmMsgFields = parseWireFields(dsmMsgField2!.bytes!);
    expect(dsmMsgFields.some((f) => f.field === 26)).toBe(false);
    expect(dsmMsgFields.some((f) => f.field === 134 && f.wireType === 2)).toBe(true);
  });

  it('leaves unregistered stickerMessage untouched on top-level field 26', () => {
    patchSoundStickerEncoder();

    const encoded = proto.Message.encode({
      stickerMessage: { url: 'https://mmg.whatsapp.net/plain' },
    }).finish();
    const fields = parseWireFields(encoded);

    expect(fields.some((f) => f.field === 134)).toBe(false);
    expect(fields.some((f) => f.field === 26 && f.wireType === 2)).toBe(true);

    const decoded = proto.Message.decode(encoded);
    expect(decoded.stickerMessage?.url).toBe('https://mmg.whatsapp.net/plain');
  });
});
