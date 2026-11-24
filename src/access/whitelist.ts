import fs from 'node:fs/promises';
import path from 'node:path';

export interface AccessContext {
  fromMe?: boolean | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  participant?: string | null;
  participantAlt?: string | null;
}

export interface WhitelistData {
  chats: string[];
  users: string[];
}

export function normalizeJid(jid: string): string {
  const trimmed = jid.trim();
  if (!trimmed) return '';

  if (trimmed.includes('@')) {
    const atIndex = trimmed.indexOf('@');
    const userAndDevice = trimmed.slice(0, atIndex);
    const server = trimmed.slice(atIndex + 1);
    const colonIndex = userAndDevice.indexOf(':');
    const cleanUser = colonIndex >= 0 ? userAndDevice.slice(0, colonIndex) : userAndDevice;
    return `${cleanUser}@${server}`;
  }

  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function collectNormalized(candidates: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  for (const item of candidates) {
    if (!item) continue;
    const normalized = normalizeJid(item);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

export class WhitelistStore {
  private readonly filePath: string;
  private readonly ownerJid?: string;
  private chats = new Set<string>();
  private users = new Set<string>();

  constructor(dataDir: string, ownerJid?: string) {
    this.filePath = path.join(dataDir, 'whitelist.json');
    this.ownerJid = ownerJid ? normalizeJid(ownerJid) : undefined;
  }

  async load(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WhitelistData>;
      this.chats = new Set((parsed.chats ?? []).map(normalizeJid).filter(Boolean));
      this.users = new Set((parsed.users ?? []).map(normalizeJid).filter(Boolean));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        this.chats.clear();
        this.users.clear();
        await this.save();
        return;
      }
      throw error;
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const payload: WhitelistData = {
      chats: Array.from(this.chats).sort(),
      users: Array.from(this.users).sort(),
    };
    await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    await fs.rename(tmpPath, this.filePath);
  }

  isOwner(ctx: AccessContext): boolean {
    if (ctx.fromMe === true) return true;
    if (!this.ownerJid) return false;

    const senderCandidates = collectNormalized([
      ctx.participant,
      ctx.participantAlt,
      ctx.remoteJid,
      ctx.remoteJidAlt,
    ]);
    return senderCandidates.includes(this.ownerJid);
  }

  isAuthorized(ctx: AccessContext): boolean {
    if (this.isOwner(ctx)) return true;

    const chatCandidates = collectNormalized([ctx.remoteJid, ctx.remoteJidAlt]);
    for (const chat of chatCandidates) {
      if (this.chats.has(chat)) return true;
    }

    const senderCandidates = collectNormalized([
      ctx.participant,
      ctx.participantAlt,
      ctx.remoteJid,
      ctx.remoteJidAlt,
    ]);
    for (const sender of senderCandidates) {
      if (this.users.has(sender)) return true;
    }

    return false;
  }

  async allow(rawJid: string): Promise<{ added: boolean; jid: string; kind: 'chat' | 'user' }> {
    const jid = normalizeJid(rawJid);
    if (!jid) {
      throw new Error('JID ou número inválido.');
    }

    const isGroup = jid.endsWith('@g.us');
    const targetSet = isGroup ? this.chats : this.users;
    const existed = targetSet.has(jid);
    targetSet.add(jid);

    if (!existed) {
      await this.save();
    }

    return {
      added: !existed,
      jid,
      kind: isGroup ? 'chat' : 'user',
    };
  }

  async deny(rawJid: string): Promise<{ removed: boolean; jid: string }> {
    const jid = normalizeJid(rawJid);
    if (!jid) {
      throw new Error('JID ou número inválido.');
    }

    const removedChat = this.chats.delete(jid);
    const removedUser = this.users.delete(jid);
    const removed = removedChat || removedUser;

    if (removed) {
      await this.save();
    }

    return { removed, jid };
  }

  list(): WhitelistData {
    return {
      chats: Array.from(this.chats).sort(),
      users: Array.from(this.users).sort(),
    };
  }
}
