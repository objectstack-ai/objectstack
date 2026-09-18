---
'@objectstack/spec': minor
---

`@objectstack/spec/data` now exports the typed hook `ctx.api` face — `HookApi`, `HookObjectApi`, `HookQuery`, `HookCountQuery`, `HookUpdateDoc`, `HookUpdateOptions`, `HookDeleteOptions`, `HookDoc` and `HookDriverPassthroughOptions` — so a metadata app's `*.hook.ts` imports the platform's type instead of hand-declaring one (#18163).

```ts
import type { HookApi } from '@objectstack/spec/data';

const api = ctx.api as HookApi | undefined;
if (!api) return;
const owner = await api.object('user').findOne({ where: { id: ctx.input.owner } });
```

The platform already implemented this surface; it just never published a type an app could import, so every app re-derived the engine's option vocabulary in a copy that drifts the moment the engine moves. The reference third-party app carried ~2,358 authored tokens of one in a single file, imported by 17 hook files.

- **The query shape is `where`-only — there is no `filter` key, deliberately.** `RPC_QUERY_ALIAS_SLOTS` declares `filter` as the alias of `where` (and `top` as the alias of `limit`); every engine entry point folds the `where` slot, collapsing redundant identical spellings and REFUSING the slot when the two spellings carry different values. So `{ where, filter }` is silent when they happen to agree and a runtime throw when they do not. Omitting the alias keys makes it neither: `TS2353: 'filter' does not exist in type 'HookQuery'`, at the authoring site.
- **Not a second dialect of `IScopedContext`.** `contracts/scoped-context.ts` stays the CHECKED IMPLEMENTATION contract ObjectQL's `ScopedContext` and `ObjectRepository` carry `implements` clauses against, with its deliberately loose `Record<string, unknown>` bags. This is the authoring half of the same seam: `HookApi` is assignable to `IScopedContext`, so `ctx.api as HookApi` stays a direct cast, and nothing about the older contract changes.
- **Every option shape is DERIVED, not transcribed.** Each is an `Omit`/`Pick` over the `Engine*Options` schemas that the engine's own per-method legal-key sets are pinned against, so a key added to a schema reaches the published type in the same run it reaches the engine's accepted set. `count` is the one shape without the driver pass-through keys, because the engine forwards no bag on that method and rejects them there — engine behaviour no document states, and exactly what a hand-written copy gets wrong.
- **What is deliberately absent, each for a stated reason**: `context` (the repository injects it and discards a caller's), the `cursor` / `distinct` / `upsert` tombstones, `sudo()` (the #5945 exclusion stands — `Hook.runAs: 'system'` is the declared way to run elevated), and `aggregate` / `execute` / `create` / `deleteById`.

Additive only: nine new exported names from `./data`, no removal and no signature change, so nothing an existing consumer imports moves.

Clause-②: yes (widening)
