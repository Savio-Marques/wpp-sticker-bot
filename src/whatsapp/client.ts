import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
  type MessageUpsertType,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import qrcode from 'qrcode-terminal';

export interface WhatsAppClientOptions {
  dataDir: string;
  phoneNumber?: string;
  logger: Logger;
  onMessage: (sock: WASocket, msg: WAMessage, type: MessageUpsertType) => Promise<void>;
}

export class WhatsAppClient {
  private readonly opts: WhatsAppClientOptions;
  private sock: WASocket | null = null;
  private connected = false;
  private stopped = false;
  private reconnectDelayMs = 2000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingCodeRequested = false;

  constructor(opts: WhatsAppClientOptions) {
    this.opts = opts;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore close errors
      }
      this.sock = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const authDir = path.join(this.opts.dataDir, 'auth');
    await fs.mkdir(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    const baileysLogger = this.opts.logger.child({ module: 'baileys' }, { level: 'warn' });

    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    this.sock = sock;
    this.pairingCodeRequested = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !state.creds.registered) {
        if (this.opts.phoneNumber) {
          if (!this.pairingCodeRequested) {
            this.pairingCodeRequested = true;
            try {
              const code = await sock.requestPairingCode(this.opts.phoneNumber);
              this.opts.logger.info(
                { pairingCode: code },
                `=== PAIRING CODE (WhatsApp -> Aparelhos conectados -> Conectar com número): ${code} ===`,
              );
            } catch (error) {
              this.pairingCodeRequested = false;
              this.opts.logger.error({ err: error }, 'Falha ao solicitar Pairing Code');
            }
          }
        } else {
          this.opts.logger.info('Escaneie o QR Code abaixo no WhatsApp:');
          qrcode.generate(qr, { small: true });
        }
      }

      if (connection === 'open') {
        this.connected = true;
        this.reconnectDelayMs = 2000;
        this.opts.logger.info({ user: sock.user?.id }, 'Conectado ao WhatsApp com sucesso');
      }

      if (connection === 'close') {
        this.connected = false;
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          this.opts.logger.error(
            'Sessão desconectada (loggedOut). Remova os arquivos de sessão em DATA_DIR/auth e pareie novamente.',
          );
          return;
        }

        if (!this.stopped) {
          const delay = this.reconnectDelayMs;
          this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000);
          this.opts.logger.warn(
            { statusCode, retryInMs: delay },
            'Conexão fechada, agendando reconexão...',
          );
          this.reconnectTimer = setTimeout(() => {
            this.connect().catch((err) => {
              this.opts.logger.error({ err }, 'Erro ao tentar reconectar');
            });
          }, delay);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const msg of messages) {
        try {
          await this.opts.onMessage(sock, msg, type);
        } catch (error) {
          this.opts.logger.error(
            { err: error, msgId: msg.key.id, remoteJid: msg.key.remoteJid },
            'Erro não tratado ao processar mensagem',
          );
        }
      }
    });
  }
}
