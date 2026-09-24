# Smart Planter

Software for a small smart hydroponic planter. See [DESIGN.md](DESIGN.md) for the full design.

## Setup

Requires **Node 22.22.2** (pinned in `.nvmrc` — Vite 7 needs ≥20.19, and the system
default here was 20.10) and **pnpm 12** via corepack.

```bash
nvm use && corepack enable && pnpm install
```

## Running it

```bash
pnpm dev
```

Starts four processes: the embedded MQTT broker, the backend, three simulated
planters and the web app. Open <http://localhost:5173>. Nothing else needs
installing — the broker is embedded (see `infra/mosquitto.conf` if you want real
Mosquitto and `mosquitto_sub` for hardware debugging).

From a phone on the same hotspot, use the Network address Vite prints. The API is
proxied through the same port, so that one address is all the phone needs.

```bash
pnpm test        # vitest across the workspace
pnpm typecheck   # tsc --noEmit across the workspace
pnpm dev:broker  # individually, if you want separate terminals
pnpm dev:backend
pnpm dev:sim
pnpm dev:web
```

## Provisioning a planter

```bash
pnpm provision --id planter-004 --name "Shelf 4"   # mint a code, write qr/planter-004.png
pnpm provision --reclaim planter-002               # fresh code for a rehearsal
pnpm qr                                            # rewrite every QR for today's IP
pnpm provision --list
```

The QR encodes this laptop's current LAN address, which a phone hotspot changes
on most reconnects — so regenerate and reprint on the day rather than in advance.

Useful env vars: `SIM_COUNT` (default 3), `MQTT_URL`, `DB_PATH`, `SIM_ENABLED=false`.

## Packages

| Package | Status |
|---|---|
| `@planter/shared` | Topics, preset schema + safety bounds, pH engine, alerts, flow, nutrients |
| `@planter/backend` | MQTT ingest, SQLite, SSE, REST API |
| `@planter/simulator` | N virtual planters + embedded broker, faults, time acceleration |
| `@planter/web` | React app — live view only so far, not yet built to the design |

`shared` is consumed straight from TypeScript source (`exports` points at `src/index.ts`),
so there is no build step: tsx, Vite and Vitest all transpile it. Type safety comes from
`pnpm typecheck`.
