import http from 'node:http';
import type { JobQueue } from '../queue/jobQueue.js';

export interface HealthServerOptions {
  port: number;
  isConnected: () => boolean;
  jobQueue: JobQueue;
}

export function startHealthServer(opts: HealthServerOptions): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        whatsappConnected: opts.isConnected(),
        queue: opts.jobQueue.stats(),
        uptimeSec: Math.floor(process.uptime()),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(opts.port, '0.0.0.0');
  return server;
}
