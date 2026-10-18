---
'@objectstack/runtime': patch
---

fix(runtime): a hook's inline `handler` function is handed the same `ctx.title(field?)` a hook `body` gets, so a source boot (`@objectstack/verify`'s `bootStack(config)`, `os serve` over an `objectstack.config.ts`) answers it as `objectstack dev` does (#24289)

Clause-②: no

A source boot runs a hook's inline `handler` in-process, and the accessor existed only in the sandbox a `body` runs in. So a hook calling `await ctx.title()` or `await ctx.title('account_id')` (a lookup column) answered on `objectstack dev` and an artifact boot, and under `bootStack(config)` refused every write with `TypeError: ctx.title is not a function`. `bindAppArtifactHandlers` now hands each inline handler function a view of the engine's hook context that answers `title` through the same accessor the sandbox installs: the same two forms, the same served formula title and related-record read on the context's own `ctx.api`, and `null`, never the record's id, when there is no title. Every other read and every write goes to the engine's context unchanged, and that context gains no key. A `handler` that names a function (the deprecated string form) is not covered by this change.
