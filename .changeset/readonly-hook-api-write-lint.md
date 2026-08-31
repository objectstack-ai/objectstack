---
'@objectstack/lint': minor
---

Add `validateReadonlyHookWrites` — an author-time gate on a hook body writing a `readonly` field through `ctx.api`.

A hook's `ctx.api` is a `ScopedContext` over the **triggering** operation's execution context, so `ctx.api.object('x').update({ someReadonlyField })` reaches the engine as an ordinary non-system caller and the update path strips the key. The call returns success, the step looks clean, and the column is simply always null — a failure only an end-to-end read-back detects. This completes the hook side of the flow-side gate that shipped as `flow-update-readonly-field`.

Two new rule ids, wired through `REFERENCE_INTEGRITY_RULES` so they run on `os validate`, `os lint` and `os compile`:

- `hook-api-update-readonly-field` — **error**. A literal `ctx.api.object('…').update()` / `.updateById()` writing a field the named object declares `readonly: true`.
- `hook-api-update-readonly-when-field` — **warning**. The same write against a `readonlyWhen` field, which strips per record state.

The rule keys on the write **channel**, not on the field, so the correct and widely used pairing is untouched: a `beforeInsert`/`beforeUpdate` body stamping `ctx.input.<field> = …` writes a server value that survives the strip and is **never** flagged. Also skipped, each for a stated reason: `ctx.api.sudo()` chains (elevated — the intended channel), `insert`/`create` (INSERT is engine-exempt), dynamic object names, non-literal payloads, objects this stack does not declare, fields the object does not declare, and `id` in an `update` payload (the row address, not a field write).
