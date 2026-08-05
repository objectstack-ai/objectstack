# @objectstack/example-crm — Minimal CRM Smoke-Test App

A deliberately tiny CRM workspace that exercises the **metadata application
loading pipeline** end-to-end. It is **not** a feature showcase — for the
full enterprise reference (10+ objects, AI agents, RAG, sharing rules,
approval flows, multi-driver E2E) see
**[github.com/objectstack-ai/hotcrm](https://github.com/objectstack-ai/hotcrm)**.

## Purpose

This example exists so the framework monorepo can validate that a realistic,
relational metadata bundle compiles and boots:

- `objects/` — 3 related objects (`account`, `contact`, `opportunity`) with
  `lookup`, `select`, `formula`, and `currency` field types
- `views/` — list + form views for one object (exercise the view loader)
- `apps/` — one app shell with grouped navigation
- `dashboards/` — one dashboard widget
- `hooks/` — one `beforeInsert` hook (formula-derived data)
- `flows/` — one record-triggered automation flow
- `data/` — small seed dataset using `defineDataset` + `cel\`...\``
  install-time expressions
- `tests/smoke.test.ts` — Zod-validates every piece of metadata

## How to run

```bash
# From the monorepo root
pnpm --filter @objectstack/example-crm dev

# Or from this directory
cd examples/app-crm
pnpm dev          # starts CLI dev server (REST API + Studio UI)
pnpm build        # compiles to dist/objectstack.json
pnpm test         # vitest smoke test
```

Open <http://localhost:3000/_studio/> after `pnpm dev` boots.

## What this example is **not**

- Not a "real" CRM — fields and relationships are intentionally minimal.
- Not a place to add new feature demos. Add them to
  [hotcrm](https://github.com/objectstack-ai/hotcrm) instead.
- Not a driver-acceptance harness. Driver E2E lives next to each driver
  package (`packages/drivers/driver-*/src/*.test.ts`) and in
  [hotcrm](https://github.com/objectstack-ai/hotcrm).

## License

Apache-2.0
