# Smart Planter

Software for a small smart hydroponic planter. See [DESIGN.md](DESIGN.md) for the full design.

## Setup

Requires **Node 22.22.2** (pinned in `.nvmrc` — Vite 7 needs ≥20.19, and the system
default here was 20.10) and **pnpm 12** via corepack.

```bash
nvm use && corepack enable && pnpm install
```

## Commands

```bash
pnpm test        # vitest across the workspace
pnpm typecheck   # tsc --noEmit across the workspace
pnpm dev:backend # tsx watch
pnpm dev:sim     # tsx watch
pnpm dev:web     # vite, bound to 0.0.0.0 so the phone can reach it
```

## Packages

| Package | Status |
|---|---|
| `@planter/shared` | pH rules engine + tests. zod schemas next. |
| `@planter/backend` | stub — MQTT, SQLite, REST + SSE to come |
| `@planter/simulator` | stub — virtual planters to come |
| `@planter/web` | stub — React PWA to come |

`shared` is consumed straight from TypeScript source (`exports` points at `src/index.ts`),
so there is no build step: tsx, Vite and Vitest all transpile it. Type safety comes from
`pnpm typecheck`.
