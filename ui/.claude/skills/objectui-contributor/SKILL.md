---
name: objectui-contributor
description: Repo-internal rules for contributors editing THIS monorepo — the Console reference app (`apps/console`, `@object-ui/app-shell`) and the Shadcn-synced primitives under `packages/components/src/ui/`. Use when working on this repository's own source, not when authoring an app with the published `@object-ui/*` packages.
user-invocable: false
---

# ObjectUI contributor rules (this repository only)

Everything here addresses someone editing **this monorepo**. It is deliberately not
part of the published `skills/objectui/` bundle: a customer install has no
`apps/console/`, no `packages/components/src/ui/`, and no `scripts/shadcn-sync.js`,
so shipping these files cost every customer session tokens it could never use.

| Topic | File |
|---|---|
| Console app: architecture, metadata-admin registry, routing, MSW debugging, retired names | [`guides/console-development.md`](./guides/console-development.md) |
| Shadcn-synced primitives are overwritten by the sync script — wrap, never edit | [`rules/no-touch-zones.md`](./rules/no-touch-zones.md) |

Customer-facing ObjectUI authoring knowledge stays in `skills/objectui/`.
