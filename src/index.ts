import pino from 'pino';
import { WhitelistStore } from './access/whitelist.js';
import { createMessageRouter } from './commands/router.js';
import { loadConfig, resolveFfmpegPath } from './config/env.js';
import { startHealthServer } from './health/server.js';
import { JobQueue } from './queue/jobQueue.js';
import { SentMessageTracker } from './whatsapp/antiLoop.js';
import { WhatsAppClient } from './whatsapp/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const ffmpegPath = await resolveFfmpegPath(process.env.FFMPEG_PATH);

  logger.info(
    {
      dataDir: config.dataDir,
      ffmpegPath,
      maxVideoSeconds: config.maxVideoSeconds,
      maxInputMb: config.maxInputMb,
      maxConcurrentJobs: config.maxConcurrentJobs,
    },
    'Iniciando wpp-sticker-bot',
  );

  const whitelist = new WhitelistStore(config.dataDir, config.ownerJid);
  await whitelist.load();

  const antiLoop = new SentMessageTracker();
  const jobQueue = new JobQueue(config.maxConcurrentJobs, config.maxQueueSize);

  const handleMessage = createMessageRouter({
    config,
    ffmpegPath,
    logger,
    whitelist,
    antiLoop,
    jobQueue,
  });

  const client = new WhatsAppClient({
    dataDir: config.dataDir,
    phoneNumber: config.phoneNumber,
    logger,
    onMessage: handleMessage,
  });

  const healthServer = startHealthServer({
    port: config.healthPort,
    isConnected: () => client.isConnected(),
    jobQueue,
  });

  await client.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Encerrando bot...');

    await Promise.allSettled([
      new Promise<void>((resolve) => healthServer.close(() => resolve())),
      jobQueue.drain(),
      client.close(),
    ]);

    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Erro fatal ao iniciar o bot:', error);
  process.exit(1);
});
