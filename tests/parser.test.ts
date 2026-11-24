import type { WAMessage } from '@whiskeysockets/baileys';
import { describe, expect, it } from 'vitest';
import { extractMessageText, parseCommand } from '../src/commands/parser.js';

describe('parseCommand', () => {
  it('parses !fig and !s case-insensitively with extra whitespace', () => {
    expect(parseCommand('!fig')).toEqual({ name: 'sticker' });
    expect(parseCommand('  !FIG  ')).toEqual({ name: 'sticker' });
    expect(parseCommand('!s')).toEqual({ name: 'sticker' });
    expect(parseCommand('!S   algo')).toEqual({ name: 'sticker' });
  });

  it('parses !help and !list', () => {
    expect(parseCommand('!help')).toEqual({ name: 'help' });
    expect(parseCommand('!LIST')).toEqual({ name: 'list' });
  });

  it('parses !allow and !deny with optional target', () => {
    expect(parseCommand('!allow')).toEqual({ name: 'allow' });
    expect(parseCommand('!allow 5511999999999')).toEqual({
      name: 'allow',
      target: '5511999999999',
    });
    expect(parseCommand('!deny')).toEqual({ name: 'deny' });
    expect(parseCommand('!deny 120363000@g.us')).toEqual({
      name: 'deny',
      target: '120363000@g.us',
    });
  });

  it('ignores normal messages and unknown commands', () => {
    expect(parseCommand('ola tudo bem')).toBeNull();
    expect(parseCommand('!figura')).toBeNull();
    expect(parseCommand('!unknown')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

describe('extractMessageText', () => {
  it('extracts text from conversation, extendedText, image caption and video caption', () => {
    const conv: WAMessage = { key: {}, message: { conversation: '!help' } };
    const ext: WAMessage = { key: {}, message: { extendedTextMessage: { text: '!s' } } };
    const img: WAMessage = { key: {}, message: { imageMessage: { caption: '!fig' } } };
    const vid: WAMessage = { key: {}, message: { videoMessage: { caption: ' !fig ' } } };
    const eph: WAMessage = {
      key: {},
      message: { ephemeralMessage: { message: { imageMessage: { caption: '!s' } } } },
    };

    expect(extractMessageText(conv)).toBe('!help');
    expect(extractMessageText(ext)).toBe('!s');
    expect(extractMessageText(img)).toBe('!fig');
    expect(extractMessageText(vid)).toBe(' !fig ');
    expect(extractMessageText(eph)).toBe('!s');
  });
});
