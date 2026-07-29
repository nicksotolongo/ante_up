---
name: NFL Picks stack
description: Full stack for the NFL picks league app — backend, frontend, codegen, auth.
---

# NFL Picks League — Stack

**Why:** This is the authoritative stack decision. Do not invent alternatives.

- **Backend:** Express 5 + Drizzle ORM + PostgreSQL (`artifacts/api-server/`)
- **Frontend:** React + Vite + Tailwind v4 (`artifacts/nfl-picks/`)
- **API contract:** `lib/api-spec/openapi.yaml` → Orval codegen
- **Frontend hooks:** `lib/api-client-react/` (auto-generated, import from `@workspace/api-client-react`)
- **Server Zod:** `lib/api-zod/` (auto-generated, import from `@workspace/api-zod`)
- **DB schema:** `lib/db/src/schema/` — auth.ts, leagues.ts, pickEvents.ts
- **Auth:** Replit Auth OIDC/PKCE — `@workspace/replit-auth-web` on frontend, `artifacts/api-server/src/routes/auth.ts` on backend
- **Mock NFL odds:** `artifacts/api-server/src/lib/mockNflGames.ts` — provider interface ready for real API swap

**Regenerate codegen after spec changes:**
```
pnpm --filter @workspace/api-client-react run generate
pnpm --filter @workspace/api-zod run generate
```

**Run seed:**
```
pnpm --filter @workspace/db run seed
```
