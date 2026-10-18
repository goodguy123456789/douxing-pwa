# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

### Anonymous room retention

- Rooms expire 24 hours after creation. All room access and mutations reject expired rooms, even before physical cleanup.
- While the API process is running, cleanup runs at startup and every minute. Each run deletes at most 1,000 expired rooms in batches of 100; existing foreign keys also delete their participants and saved preferences (including drafts retained across rounds).
- Locked rooms are skipped until a later run. Each batch has a 5-second statement timeout and a 1-second lock timeout. Failures log a fixed message without private data and retry on the next interval.
- Physical deletion is normally within one minute after expiry, but backlog, database failures, long-held locks or a stopped API can delay it. Startup catches up after downtime; this is not a cleanup guarantee while the service is stopped. No external scheduler or deployment change is required.
- `pnpm --filter @workspace/api-server run test:retention` — database retention/access regression tests; requires the development database and running API workflow. Cascade/batch checks roll back; HTTP fixtures are removed afterward.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
