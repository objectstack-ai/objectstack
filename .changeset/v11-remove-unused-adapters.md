---
"@objectstack/client": minor
"@objectstack/runtime": patch
---

Remove the unused HTTP framework adapters and the MSW plugin — the open edition ships the **Hono** adapter only.

The `express` / `fastify` / `nextjs` / `nestjs` / `nuxt` / `sveltekit` adapters and
`@objectstack/plugin-msw` had **zero internal consumers** and were not dogfooded —
pure release/maintenance surface (and an untested-integration liability). They are
removed; `@objectstack/hono` (the adapter actually used, via `@objectstack/client`)
is kept.

- Deleted packages: `@objectstack/express`, `@objectstack/fastify`,
  `@objectstack/nextjs`, `@objectstack/nestjs`, `@objectstack/nuxt`,
  `@objectstack/sveltekit`, `@objectstack/plugin-msw` (fixed group 73 → 66).
- `@objectstack/client`: dropped the `plugin-msw` / `msw` dev usage (MSW test removed).
- `HttpDispatcher` (the dispatch engine) is now used only by the Hono adapter +
  the internal dispatcher-plugin, so its misleading `@deprecated → createDispatcherPlugin`
  note (createDispatcherPlugin is a kernel plugin, not a drop-in) is corrected.

Anyone needing another framework adapter can build one on the public
`HttpDispatcher` / `createDispatcherPlugin` API or maintain it out-of-tree.
