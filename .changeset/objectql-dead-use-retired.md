---
"@objectstack/objectql": major
---

fix(objectql)!: retire the dead `ObjectQLEngine.use()` plugin path (#4212 follow-up)

`ObjectQLEngine.use(manifestPart, runtimePart)` was the engine's own plugin
loader: register a manifest, then dispatch the runtime part's `onEnable` with
an `ObjectQLHostContext`. **Nothing calls it** — not the kernel (plugins go
through `kernel.use()` → `init`/`start`), not the CLI, not a test, not an
example, repo-wide. Its `onEnable` dispatch is the engine-level twin of the
#4212 disease: a lifecycle entry point that reads as a contract and never
runs. The *app-bundle* `onEnable` module export is a different, real contract
(dispatched by AppPlugin at boot) and is unchanged.

Removed:

- `ObjectQLEngine.use()`.
- `ObjectQLHostContext` (exported from `@objectstack/objectql` and
  `@objectstack/objectql/core`) — constructed only inside the dead method.
- The engine's private `hostContext` field — its only read outside the dead
  method was the constructor's `logger` extraction, which stays; the
  constructor signature is unchanged (`new ObjectQL({ logger })` keeps
  working, as does `ObjectQLPlugin`'s `hostContext` option that feeds it).

FROM → TO:

- `engine.use(manifest)` → `engine.registerApp(manifest)` (the alive half —
  the manifest service and ObjectQLPlugin already route through it).
- `engine.use(_, { onEnable })` → a kernel plugin: `kernel.use({ name,
  init(ctx) { … } })`; the engine is `ctx.getService('objectql')`, drivers
  register via `engine.registerDriver()`.
- `ObjectQLHostContext` → no replacement; the type described the context of
  a hook that never fired.
