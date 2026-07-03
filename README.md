# SyncRoom

**Crystal-clear video calls with perfectly synchronized watch parties.**
Google Meet + Teleparty in one stateless, self-hostable web app.

Create a room, share the code, talk face-to-face in up to 4K60 — then paste a YouTube / Google Drive / MP4 / HLS / DASH link and everyone watches in lock-step: play, pause, seek, speed, late-join catch-up and automatic drift correction.

---

## Requirements

- **Node.js ≥ 20** (check with `node -v`)
- **npm ≥ 9** (ships with Node 20; used for workspaces)
- A modern browser — Chrome/Edge recommended; Firefox and Safari supported

## Setup

**1. Clone the repository**

```bash
git clone https://github.com/aditi1006/SyncRoom.git
cd SyncRoom
```

**2. Install dependencies** (installs all three workspaces — `shared`, `server`, `client`)

```bash
npm install
```

**3. Configure environment variables** (optional for local dev — sensible defaults are used if omitted)

```bash
cp .env.example .env    # Windows PowerShell: Copy-Item .env.example .env
```

Then edit `.env`:

| Variable                                        | Scope           | Purpose                                                              |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| `PORT`                                          | server          | Port the signaling/HTTP server listens on (default `3001`).         |
| `CLIENT_ORIGIN`                                 | server          | CORS origin when the client is hosted separately.                   |
| `VITE_SERVER_URL`                               | client (build)  | Socket server URL when not served from the same origin.             |
| `VITE_TURN_URL` / `_USERNAME` / `_CREDENTIAL`   | client (build)  | TURN relay for strict-NAT peers — **strongly recommended in prod**. |

**4. Start the dev servers**

```bash
npm run dev       # server on :3001 + client on :5173 (Vite proxies to the server)
```

Open <http://localhost:5173>, create a room, then open a second browser or incognito window and join with the room code.

> **Note:** Camera/mic access requires a secure context. `localhost` counts as secure, so local dev works without HTTPS. When deploying, serve over HTTPS or WebRTC media will be blocked.

## Production

```bash
npm run build     # builds shared + server (tsup) + client (vite)
npm start         # one Node process serves the built SPA + signaling on :3001
```

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for single-server vs. split deploys, TURN setup, and scaling.

## Scripts

| Command                   | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `npm run dev`             | Server (tsx watch) + client (Vite HMR) concurrently |
| `npm run build`           | Production build of all workspaces                  |
| `npm start`               | Run the production server (serves built SPA too)    |
| `npm run typecheck`       | Strict TypeScript across all workspaces             |
| `npm run lint` / `format` | ESLint / Prettier                                   |
| `npm test`                | Unit + integration tests (Vitest)                   |
| `npm run test:e2e`        | Playwright end-to-end tests (build first)           |

## Feature highlights

- **Rooms** — random Meet-style or custom codes, host badge, lock/unlock, kick, force-mute, host transfer, end-for-all, refresh recovery, duplicate-join protection, rate limiting.
- **Calls** — P2P WebRTC mesh (up to 8), camera/mic/screen share, device switching, quality presets up to **4K @ 60fps**, noise suppression, echo cancellation, per-peer RTT / packet-loss / bitrate indicators, picture-in-picture, fullscreen, auto-reconnect.
- **Watch together** — YouTube, Google Drive (with documented limitations), MP4/WebM, HLS, MPEG-DASH. Host-authoritative sync with clock-offset estimation and invisible playback-rate drift correction. Queue + shared-controls mode.
- **Chat** — realtime messages, emoji, typing indicator, read receipts, image/file sharing (drag & drop), copy, delete-own, timestamps, unread badge, desktop notifications.
- **UI** — dark/light themes, glassmorphism, keyboard shortcuts, reduced-motion support, responsive from phone to ultrawide.

## Documentation

| Doc                                          | Contents                                               |
| -------------------------------------------- | ------------------------------------------------------ |
| [ARCHITECTURE.md](./ARCHITECTURE.md)         | System design, why P2P over SFU, sync algorithm        |
| [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) | Repo layout, workflows, adding features, testing       |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)   | Single-server deploy, split deploy, TURN, scaling      |
| [docs/FEATURES.md](./docs/FEATURES.md)       | Every feature in detail + **Google Drive limitations** |
| [docs/ROADMAP.md](./docs/ROADMAP.md)         | What's deliberately deferred and how to add it         |

## Project structure

```
syncroom/
├── shared/        # @syncroom/shared — protocol types, validation, sync math (zero deps)
├── server/        # @syncroom/server — Node + Socket.IO signaling & room state (in-memory)
├── client/        # @syncroom/client — Vite + React SPA
│   └── src/
│       ├── components/   # UI primitives (Button, Modal, …)
│       ├── features/     # feature-sliced: home, lobby, room, call, chat, sync, settings
│       ├── hooks/        # theme, fullscreen, shortcuts
│       ├── lib/          # socket, session, utils
│       └── store/        # zustand stores (room state, persisted settings)
├── e2e/           # Playwright tests
└── docs/
```

## License

MIT — see [LICENSE](./LICENSE).
