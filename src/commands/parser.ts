import type { WAMessage } from '@whiskeysockets/baileys';
import { unwrapMessage } from '../media/downloader.js';

export type ParsedCommand =
  | { name: 'sticker' }
  | { name: 'sound_sticker' }
  | { name: 'help' }
  | { name: 'allow'; target?: string }
  | { name: 'deny'; target?: string }
  | { name: 'list' };

export function parseCommand(text: string | null | undefined): ParsedCommand | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('!')) return null;

  const spaceIdx = trimmed.search(/\s/);
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx).trim();

  switch (cmd) {
    case '!fig':
    case '!s':
      return { name: 'sticker' };
    case '!figsom':
    case '!ss':
      return { name: 'sound_sticker' };
    case '!help':
      return { name: 'help' };
    case '!allow':
      return rest ? { name: 'allow', target: rest } : { name: 'allow' };
    case '!deny':
      return rest ? { name: 'deny', target: rest } : { name: 'deny' };
    case '!list':
      return { name: 'list' };
    default:
      return null;
  }
}

export function extractMessageText(msg: WAMessage): string | undefined {
  const content = unwrapMessage(msg.message);
  if (!content) return undefined;

  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    undefined
  );
}
