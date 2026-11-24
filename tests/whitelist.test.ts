import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeJid, WhitelistStore } from '../src/access/whitelist.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-wl-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('normalizeJid', () => {
  it('strips device suffix and converts digits to s.whatsapp.net', () => {
    expect(normalizeJid('5511999999999:12@s.whatsapp.net')).toBe('5511999999999@s.whatsapp.net');
    expect(normalizeJid('123456:0@lid')).toBe('123456@lid');
    expect(normalizeJid('120363000000000000@g.us')).toBe('120363000000000000@g.us');
    expect(normalizeJid('+55 11 99999-9999')).toBe('5511999999999@s.whatsapp.net');
  });
});

describe('WhitelistStore', () => {
  it('persists atomically and reloads chats and users', async () => {
    const dir = await makeTempDir();
    const store = new WhitelistStore(dir, '5511888888888@s.whatsapp.net');
    await store.load();

    await store.allow('120363000000000000@g.us');
    await store.allow('5511777777777');

    const reloaded = new WhitelistStore(dir, '5511888888888@s.whatsapp.net');
    await reloaded.load();

    expect(reloaded.list()).toEqual({
      chats: ['120363000000000000@g.us'],
      users: ['5511777777777@s.whatsapp.net'],
    });
  });

  it('authorizes owner via fromMe or OWNER_JID and handles @lid alt fields', async () => {
    const dir = await makeTempDir();
    const store = new WhitelistStore(dir, '5511888888888@s.whatsapp.net');
    await store.load();
    await store.allow('5511777777777');
    await store.allow('120363000000000000@g.us');

    expect(store.isOwner({ fromMe: true, remoteJid: 'any@s.whatsapp.net' })).toBe(true);
    expect(
      store.isOwner({
        fromMe: false,
        remoteJid: '120363999@g.us',
        participant: '99999@lid',
        participantAlt: '5511888888888:4@s.whatsapp.net',
      }),
    ).toBe(true);

    expect(
      store.isAuthorized({
        fromMe: false,
        remoteJid: '11111@lid',
        remoteJidAlt: '5511777777777:2@s.whatsapp.net',
      }),
    ).toBe(true);

    expect(
      store.isAuthorized({
        fromMe: false,
        remoteJid: '120363000000000000@g.us',
        participant: '5511000000000@s.whatsapp.net',
      }),
    ).toBe(true);

    expect(
      store.isAuthorized({
        fromMe: false,
        remoteJid: '120363999999999999@g.us',
        participant: '5511000000000@s.whatsapp.net',
      }),
    ).toBe(false);

    const denyRes = await store.deny('120363000000000000@g.us');
    expect(denyRes.removed).toBe(true);
    expect(
      store.isAuthorized({
        fromMe: false,
        remoteJid: '120363000000000000@g.us',
        participant: '5511000000000@s.whatsapp.net',
      }),
    ).toBe(false);
  });
});
