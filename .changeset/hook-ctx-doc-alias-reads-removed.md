---
'@objectstack/service-storage': patch
'@objectstack/plugin-sharing': patch
'@objectstack/runtime': patch
---

hooks: drop the last three `doc` / `previousDoc` alias reads on a hook context — read the engine's own keys only

Behaviour is unchanged: every one of these limbs guarded against a producer that
has never existed, so none of them could be reached.

- `service-storage` attachment lifecycle read `ctx.result ?? ctx.input.doc ?? ctx.input.data`
- `plugin-sharing` primary-BU projection read `(ctx.input.data ?? ctx.input.doc).user_id`
- `runtime`'s hook sandbox read `engineCtx.input ?? engineCtx.doc` and `engineCtx.previous ?? engineCtx.previousDoc`

Every ObjectQL write context spells the payload `data` — measured and pinned by
`hook-input-shape-contract.test.ts` in `@objectstack/objectql` ("insert carries
`data` — never `doc`", #5273). The top-level pair is the same family one level
up: `HookContextSchema` declares `input` / `result` / `previous` and neither a
`doc` nor a `previousDoc`, and `engine.ts` — the sole producer of a HookContext
— builds neither. The limbs survived only because the old `HookContext.input`
contract table documented insert as `{ doc, options }`; that table was corrected
in #5668, and the same alias was removed from `trigger-record-change` in #5671.
These are the remainder (#5906), removed rather than left as a second de-facto
contract (PD #12).
