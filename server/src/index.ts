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
import { driveProxy } from './driveProxy';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Streams a public Google Drive file so it plays in the synced HTML5 player
// instead of Drive's un-syncable preview iframe. Registered before the SPA
// catch-all so it isn't swallowed by the index.html fallback.
app.get('/drive/:id', driveProxy);

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
    origin: [CLIENT_ORIGIN],
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
