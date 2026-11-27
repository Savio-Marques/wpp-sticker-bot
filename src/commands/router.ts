import {
  isJidStatusBroadcast,
  type MessageUpsertType,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import type { Logger } from 'pino';
import { normalizeJid, type AccessContext, type WhitelistStore } from '../access/whitelist.js';
import type { AppConfig } from '../config/env.js';
import {
  AudioTooLargeError,
  convertAudioToStickerOpus,
  NoAudioTrackError,
} from '../media/audioConverter.js';
import {
  downloadValidatedMedia,
  extractMediaTarget,
  extractSoundStickerTarget,
  MediaTooLargeError,
} from '../media/downloader.js';
import { StickerTooLargeError } from '../media/exif.js';
import { convertImageToSticker } from '../media/imageConverter.js';
import { convertVideoToSticker } from '../media/videoConverter.js';
import { JobQueue, QueueFullError } from '../queue/jobQueue.js';
import type { SentMessageTracker } from '../whatsapp/antiLoop.js';
import { sendSoundSticker } from '../whatsapp/soundSticker.js';
import { extractMessageText, parseCommand } from './parser.js';

export interface RouterDeps {
  config: AppConfig;
  ffmpegPath: string;
  logger: Logger;
  whitelist: WhitelistStore;
  antiLoop: SentMessageTracker;
  jobQueue: JobQueue;
}

const HELP_TEXT = [
  '*Bot de Figurinhas*',
  '• `!fig` ou `!s` na legenda de uma imagem, GIF ou vídeo — cria figurinha 512×512.',
  '• `!fig` ou `!s` respondendo uma imagem, GIF ou vídeo — cria figurinha.',
  '• `!figsom` ou `!ss` em um vídeo com áudio, ou imagem respondendo um áudio — cria figurinha com som.',
  '• Vídeos/GIFs são cortados automaticamente nos primeiros segundos.',
  '• `!help` — mostra esta ajuda.',
].join('\n');

function toNumberTimestamp(ts: WAMessage['messageTimestamp']): number | undefined {
  if (ts === null || ts === undefined) return undefined;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'bigint') return Number(ts);
  if (typeof ts === 'object' && typeof ts.toNumber === 'function') return ts.toNumber();
  return undefined;
}

function getAccessContext(msg: WAMessage): AccessContext {
  return {
    fromMe: msg.key.fromMe,
    remoteJid: msg.key.remoteJid,
    remoteJidAlt: msg.key.remoteJidAlt,
    participant: msg.key.participant,
    participantAlt: msg.key.participantAlt,
  };
}

function getCooldownKey(msg: WAMessage): string {
  const raw =
    msg.key.participantAlt ??
    msg.key.participant ??
    msg.key.remoteJidAlt ??
    msg.key.remoteJid ??
    'unknown';
  return normalizeJid(raw) || raw;
}

export function createMessageRouter(deps: RouterDeps) {
  const { config, ffmpegPath, logger, whitelist, antiLoop, jobQueue } = deps;
  const cooldownMap = new Map<string, number>();

  async function sendTracked(
    sock: WASocket,
    jid: string,
    content: Parameters<WASocket['sendMessage']>[1],
    quoted?: WAMessage,
  ): Promise<void> {
    const sent = await sock.sendMessage(jid, content, quoted ? { quoted } : undefined);
    antiLoop.track(sent?.key?.id);
  }

  async function react(sock: WASocket, msg: WAMessage, emoji: string): Promise<void> {
    const jid = msg.key.remoteJid;
    if (!jid) return;
    try {
      const sent = await sock.sendMessage(jid, {
        react: { text: emoji, key: msg.key },
      });
      antiLoop.track(sent?.key?.id);
    } catch (error) {
      logger.debug({ err: error, emoji }, 'Falha ao enviar reação');
    }
  }

  function isFreshMessage(msg: WAMessage): boolean {
    const tsSec = toNumberTimestamp(msg.messageTimestamp);
    if (!tsSec) return true;
    const ageSec = Math.floor(Date.now() / 1000) - tsSec;
    const maxAgeSec = msg.key.fromMe ? 60 : 120;
    return ageSec <= maxAgeSec;
  }

  function checkAndUpdateCooldown(senderKey: string): boolean {
    if (config.userCooldownMs <= 0) return false;
    const now = Date.now();
    const lastUsed = cooldownMap.get(senderKey);
    if (lastUsed !== undefined && now - lastUsed < config.userCooldownMs) {
      return true;
    }
    cooldownMap.set(senderKey, now);
    if (cooldownMap.size > 500) {
      for (const [k, t] of cooldownMap) {
        if (now - t >= config.userCooldownMs) {
          cooldownMap.delete(k);
        }
      }
    }
    return false;
  }

  async function handleAdminCommand(
    sock: WASocket,
    msg: WAMessage,
    remoteJid: string,
    cmd: { name: 'allow' | 'deny'; target?: string } | { name: 'list' },
  ): Promise<void> {
    if (cmd.name === 'list') {
      const { chats, users } = whitelist.list();
      const lines = [
        '*Whitelist atual:*',
        `• Grupos/Chats (${chats.length}): ${chats.length ? chats.join(', ') : 'nenhum'}`,
        `• Usuários (${users.length}): ${users.length ? users.join(', ') : 'nenhum'}`,
      ];
      await sendTracked(sock, remoteJid, { text: lines.join('\n') }, msg);
      return;
    }

    const targetRaw = cmd.target ?? remoteJid;
    try {
      if (cmd.name === 'allow') {
        const res = await whitelist.allow(targetRaw);
        const text = res.added
          ? `✅ Liberado (${res.kind === 'chat' ? 'chat/grupo' : 'usuário'}): ${res.jid}`
          : `ℹ️ Já estava liberado: ${res.jid}`;
        await sendTracked(sock, remoteJid, { text }, msg);
      } else {
        const res = await whitelist.deny(targetRaw);
        const text = res.removed
          ? `🚫 Removido da whitelist: ${res.jid}`
          : `ℹ️ Não estava na whitelist: ${res.jid}`;
        await sendTracked(sock, remoteJid, { text }, msg);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alvo inválido.';
      await sendTracked(sock, remoteJid, { text: `❌ ${message}` }, msg);
    }
  }

  return async function handleMessage(
    sock: WASocket,
    msg: WAMessage,
    upsertType: MessageUpsertType,
  ): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || isJidStatusBroadcast(remoteJid)) return;
    const chatJid: string = remoteJid;
    if (!msg.message) return;
    if (antiLoop.has(msg.key.id)) return;

    const fromMe = msg.key.fromMe === true;
    if (!fromMe && upsertType !== 'notify') return;
    if (fromMe && upsertType !== 'notify' && upsertType !== 'append') return;
    if (!isFreshMessage(msg)) return;

    const text = extractMessageText(msg);
    const cmd = parseCommand(text);
    if (!cmd) return;

    const accessCtx = getAccessContext(msg);

    if (cmd.name === 'allow' || cmd.name === 'deny' || cmd.name === 'list') {
      if (!whitelist.isOwner(accessCtx)) return;
      await handleAdminCommand(sock, msg, remoteJid, cmd);
      return;
    }

    if (!whitelist.isAuthorized(accessCtx)) return;

    if (cmd.name === 'help') {
      await sendTracked(sock, remoteJid, { text: HELP_TEXT }, msg);
      return;
    }

    if (!whitelist.isOwner(accessCtx) && checkAndUpdateCooldown(getCooldownKey(msg))) {
      await react(sock, msg, '⏱️');
      return;
    }

    async function runWithStatus(
      kindLabel: string,
      task: () => Promise<void>,
    ): Promise<void> {
      await react(sock, msg, '⏳');
      try {
        await task();
        await react(sock, msg, '');
      } catch (error) {
        await react(sock, msg, '❌');
        let reason = 'Não foi possível criar a figurinha. Tente outra mídia.';
        if (
          error instanceof MediaTooLargeError ||
          error instanceof StickerTooLargeError ||
          error instanceof QueueFullError ||
          error instanceof NoAudioTrackError ||
          error instanceof AudioTooLargeError
        ) {
          reason = error.message;
        }
        logger.warn({ err: error, remoteJid: chatJid, kind: kindLabel }, 'Erro ao gerar figurinha');
        await sendTracked(sock, chatJid, { text: `❌ ${reason}` }, msg);
      }
    }

    if (cmd.name === 'sound_sticker') {
      const target = extractSoundStickerTarget(msg);
      if (!target || target.mode === 'missing-audio') {
        await sendTracked(
          sock,
          remoteJid,
          {
            text: 'Envie um vídeo com áudio usando `!figsom`, ou envie uma imagem com `!figsom` respondendo a um áudio.',
          },
          msg,
        );
        return;
      }

      await runWithStatus(target.mode, async () => {
        const result = await jobQueue.enqueue(async () => {
          if (target.mode === 'video') {
            const rawVideo = await downloadValidatedMedia(
              target.video,
              config.maxInputMb,
              sock,
              logger,
            );
            const [webp, audio] = await Promise.all([
              convertVideoToSticker(rawVideo, {
                pack: config.stickerPack,
                author: config.stickerAuthor,
                maxDurationSec: config.maxVideoSeconds,
                ffmpegPath,
              }),
              convertAudioToStickerOpus(rawVideo, {
                maxDurationSec: config.maxVideoSeconds,
                ffmpegPath,
              }),
            ]);
            return { webp, isAnimated: true, ogg: audio.buffer, seconds: audio.seconds };
          }

          const [rawImage, rawAudio] = await Promise.all([
            downloadValidatedMedia(target.image, config.maxInputMb, sock, logger),
            downloadValidatedMedia(target.audio, config.maxInputMb, sock, logger),
          ]);
          const [webp, audio] = await Promise.all([
            convertImageToSticker(rawImage, {
              pack: config.stickerPack,
              author: config.stickerAuthor,
            }),
            convertAudioToStickerOpus(rawAudio, {
              maxDurationSec: config.maxAudioSeconds,
              ffmpegPath,
            }),
          ]);
          return { webp, isAnimated: false, ogg: audio.buffer, seconds: audio.seconds };
        });

        await sendSoundSticker(sock, remoteJid, {
          ...result,
          quoted: msg,
          logger,
          onMessageId: (id) => antiLoop.track(id),
        });
      });
      return;
    }

    const mediaTarget = extractMediaTarget(msg);
    if (!mediaTarget) {
      await sendTracked(
        sock,
        remoteJid,
        { text: 'Envie uma imagem, GIF ou vídeo com `!fig`, ou responda uma mídia com `!fig`.' },
        msg,
      );
      return;
    }

    await runWithStatus(mediaTarget.kind, async () => {
      const stickerBuffer = await jobQueue.enqueue(async () => {
        const rawMedia = await downloadValidatedMedia(
          mediaTarget,
          config.maxInputMb,
          sock,
          logger,
        );

        if (mediaTarget.kind === 'image') {
          return convertImageToSticker(rawMedia, {
            pack: config.stickerPack,
            author: config.stickerAuthor,
          });
        }

        return convertVideoToSticker(rawMedia, {
          pack: config.stickerPack,
          author: config.stickerAuthor,
          maxDurationSec: config.maxVideoSeconds,
          ffmpegPath,
        });
      });

      await sendTracked(sock, remoteJid, { sticker: stickerBuffer }, msg);
    });
  };
}
