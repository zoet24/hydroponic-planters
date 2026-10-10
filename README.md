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

## Presenter mode

Add `?presenter=1` on the machine driving the projector (`?presenter=0` turns it
off). Scales everything up, hides the connection chip, the small print and the
simulator drawer.

It is remembered per device, which is the point: the projected laptop runs
presenter mode while the phone in your hand stays normal and keeps the drawer,
so you can trigger a fault without the audience seeing the controls.

## Simulator controls

Long-press the "Smart Planter" wordmark on the home screen, or add `?dev=1` to
any URL. Gives fault injection (low water, sensor dropout, offline) and time
acceleration, so a demo never needs a terminal. Stays open across navigation,
and only appears when the backend has `SIM_ENABLED`.

## Feature flags

`packages/web/.env`:

```
VITE_AI_PRESETS=true
```

The AI preset builder is paused, so its entry points on the Config section and
the Presets grid are hidden. Flip this on when the screen exists.

## Before a demo

```bash
pnpm demo:reset
```

Wipes history, takes every planter back off the dashboard, seeds 24 hours of
history and tells the running backend to re-read it. Run it about ten minutes
before you go on, so "last seen" reads as fresh.

The dashboard is left **empty on purpose**: the talk opens on an empty dashboard
and adding a planter is the first thing demonstrated.

`--staged` adds the cast up front instead, for a rehearsal that starts after
onboarding. `--hours 48` seeds more history.

The backend keeps planters in memory, so anything written straight to SQLite
while it runs would be overwritten on the next MQTT message. The script posts to
`/api/admin/reload` to prevent that — which is also why it warns if the backend
is not running.

## Seeding history

```bash
pnpm seed                       # 24h of readings and pump runs, every planter
pnpm seed --id planter-001 --hours 48
```

Time acceleration does not create history: the backend stamps readings with real
time and throttles on real time, so running the simulator fast changes how quickly
values move, not how much history exists. Seed before a demo so the charts are full.

## Provisioning a planter

```bash
pnpm provision --id planter-004 --name "Shelf 4"   # create the row ahead of time
pnpm provision --unadd planter-002                 # back to the Add planter list
pnpm provision --list
```

Mostly optional. The backend discovers any device that publishes to MQTT and
creates the row itself, so provisioning is only for seeding a planter before it
exists, or for inspecting what the dashboard is showing.

A discovered planter stays **off** the dashboard until it is added from inside
the app, which is what keeps the fleet empty until you onboard something.

Useful env vars: `SIM_COUNT` (default 3), `SIM_START` (default 1), `MQTT_URL`,
`DB_PATH`, `SIM_ENABLED=false`.

## Running alongside the real planter

The board claims an MQTT id from `planter_id` in `firmware/esphome.yaml`
(`planter-001`). Two devices publishing under one id fight over the same topics,
so start the simulator above it:

```bash
SIM_START=2 SIM_COUNT=2 pnpm dev:sim
```

That gives one real planter and two simulated ones, which is the demo as planned.

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
