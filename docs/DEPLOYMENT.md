# Deployment guide

## Option A — free split deploy: Vercel (SPA) + Render (sockets) — recommended

Step-by-step instructions live in the [README](../README.md#deploy-for-free-vercel--render). Summary of the moving parts:

| Piece            | Where       | File          | Key config                                                                                                         |
| ---------------- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| SPA (static)     | Vercel      | `vercel.json` | build `npm run build -w client`, output `client/dist`, SPA rewrite → `index.html`, immutable caching for `/assets` |
| Socket.IO server | Render free | `render.yaml` | `npm ci && npm run build -w server`, start `node server/dist/index.js`, health check `/healthz`                    |
| CORS             | Render env  | —             | `CLIENT_ORIGIN` comma list; wildcard `https://*.vercel.app` covers preview deploys (`server/src/cors.ts`)          |
| Socket URL       | Vercel env  | —             | `VITE_SERVER_URL` (build-time; client falls back to same-origin when unset)                                        |
| TURN             | Vercel env  | —             | `VITE_TURN_URL/USERNAME/CREDENTIAL` (free tier: Open Relay)                                                        |

Why this works over HTTPS/WSS with zero extra config: Vercel and Render both terminate TLS. The client connects to `https://…onrender.com`; Socket.IO upgrades to `wss://` on the same connection. WebRTC's secure-context requirement is satisfied by Vercel's HTTPS, and all signaling (SDP/ICE relay) rides the encrypted socket. Media itself is peer-to-peer DTLS-SRTP and never touches either host — which is exactly why the free tiers hold up.

Free-plan caveats (Render): sleeps after ~15 min idle → ~50 s cold start on the next join (live WebSocket connections prevent sleeping mid-call; a 5-minute `/healthz` pinger prevents it entirely, and one always-on free service fits the 750 h/month allowance). Rooms are in-memory by design — a restart just means clients silently auto-rejoin.

Railway was rejected (free tier is now a one-time trial credit) and Fly.io requires a credit card; both remain usable via Option C if you have accounts.

## Option B — single server (one process serves SPA + sockets)

One Node process serves the SPA **and** Socket.IO. No database, no object storage, no queues.

```bash
npm ci
npm run build
PORT=3001 node server/dist/index.js
```

Put any TLS-terminating proxy in front (Caddy, nginx, or the platform's edge). **HTTPS is required in production** — browsers only expose camera/microphone on secure origins.

### Environment variables

| Variable                                      | Where        | Default                 | Purpose                                                                                  |
| --------------------------------------------- | ------------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| `PORT`                                        | server       | `3001`                  | Listen port                                                                              |
| `CLIENT_ORIGIN`                               | server       | `http://localhost:5173` | CORS allow-list, comma-separated; wildcard subdomains (`https://*.vercel.app`) supported |
| `VITE_SERVER_URL`                             | client build | _(same origin)_         | Socket server URL when hosted separately                                                 |
| `VITE_TURN_URL`                               | client build | —                       | TURN server (e.g. `turn:turn.example.com:3478`)                                          |
| `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | client build | —                       | TURN credentials                                                                         |

### Example: Caddy on a $5 VPS

```
meet.example.com {
    reverse_proxy localhost:3001
}
```

Caddy handles TLS + WebSocket upgrade automatically. A 1 vCPU / 512 MB box handles hundreds of concurrent rooms — media is peer-to-peer and never touches the server.

## Option C — container hosts (Fly.io, any Docker platform)

The repo ships a multi-stage [`Dockerfile`](../Dockerfile) building a single full-stack image (server serves the SPA):

```bash
docker build -t syncroom .
docker run -p 3001:3001 -e CLIENT_ORIGIN=https://your.domain syncroom
```

- **Fly.io** — `fly launch` detects the Dockerfile; set `CLIENT_ORIGIN` via `fly secrets set`. Requires a credit card on file (their pay-as-you-go floor), so it's not in the free-first path.
- **Not suitable for the server:** Vercel/Netlify serverless functions (no long-lived WebSockets). They're perfect for the static client (Option A).

## Generic split deployment (any static host + any Node host)

1. Deploy the server anywhere Node runs; set `CLIENT_ORIGIN=https://app.example.com` (comma-list; wildcards allowed).
2. Build the client with `VITE_SERVER_URL=https://ws.example.com` and host `client/dist` on any static host/CDN. Add an SPA fallback rewrite to `index.html` so `/room/<code>` deep links resolve.

## TURN (recommended for production)

STUN alone fails for ~10–15% of peer pairs (symmetric NATs, strict firewalls). Options:

- **Free:** [Open Relay by Metered](https://www.metered.ca/tools/openrelay/) — free TURN with generous limits; ideal companion to the Vercel+Render setup.
- **coturn** (self-hosted, open source): one small VM, `turnserver` with long-term credentials; TURN traffic only flows for the peers that need relay.
- Managed: Cloudflare Calls TURN, Twilio NTS, Metered.ca paid tiers.

Set the three `VITE_TURN_*` variables at client build time.

## Scaling notes

| Concern                                       | Answer                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| More rooms                                    | Vertical first — signaling is trivial JSON; a single instance goes very far.                                                                         |
| Multiple instances                            | Add sticky sessions + the socket.io Redis adapter, or shard rooms by code prefix at the proxy. Rooms are self-contained, so sharding is clean.       |
| >4–5 people per room, recording, mobile-heavy | Move media to an SFU (LiveKit self-hosted). See `docs/ROADMAP.md` — the room/chat/sync layers are transport-agnostic and survive the swap unchanged. |
| Server restart                                | Clients auto-rejoin with their stable identity; rooms re-form. In-flight chat history is lost (by design — nothing persists).                        |

## Operational checklist

- [ ] HTTPS on (WebRTC requirement)
- [ ] TURN configured (`VITE_TURN_*`)
- [ ] `CLIENT_ORIGIN` set if split-deployed
- [ ] `/healthz` wired to your uptime monitor
- [ ] Reverse proxy timeout ≥ 120 s for WebSocket idle
