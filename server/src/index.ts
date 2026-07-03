import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { LIMITS } from '@syncroom/shared';
import type { AppServer } from './handlers';
import { registerHandlers } from './handlers';
import { RoomManager } from './roomManager';
import { makeOriginCheck, parseAllowedOrigins } from './cors';

const PORT = Number(process.env.PORT ?? 3001);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.CLIENT_ORIGIN);

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// In production the server also serves the built SPA — one process, one port.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: 'index.html', maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const httpServer = createServer(app);

const io: AppServer = new Server(httpServer, {
  cors: {
    origin: makeOriginCheck(ALLOWED_ORIGINS),
    methods: ['GET', 'POST'],
  },
  // Attachments are relayed through the socket; allow cap + base64 overhead.
  maxHttpBufferSize: Math.ceil(LIMITS.MAX_ATTACHMENT_BYTES * 1.5),
});

const rooms = new RoomManager();
registerHandlers(io, rooms);

httpServer.listen(PORT, () => {
  console.log(`[syncroom] signaling server listening on :${PORT}`);
});

const shutdown = (): void => {
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
