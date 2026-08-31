---
'@objectstack/lint': minor
---

Add `validateReadonlyActionWrites` — an author-time warning on an action body writing a `readonlyWhen` field through `ctx.api`.

The action surface is the third write surface in the readonly family, after `flow-update-readonly-field` and `hook-api-update-readonly-field`, and it is the one where the family's answer differs. An action body's `ctx.api` is `createContext({ ...callerEnvelope, isSystem: true })` — elevated by design, so RLS/FLS-bypassing trusted execution is the documented posture — and the engine's **static** readonly strip runs only for non-system callers. Measured against a real engine over a memory driver:

| channel | static `readonly` | `readonlyWhen`, predicate TRUE |
| --- | --- | --- |
| action body `ctx.api` | lands | **stripped** |
| hook body `ctx.api`, non-system trigger | stripped | stripped |
| `ctx.api.sudo()` | lands | **stripped** |

So exactly one shape is a silent no-op on this surface, and that is what the new rule reports:

- `action-api-update-readonly-when-field` — **warning**. A literal `ctx.api.object('…').update()` / `.updateById()` in an action body writing a field the named object declares `readonlyWhen`. The conditional strip takes no `isSystem` exemption, so elevation is not a workaround and the hint does not offer one: confirm the call only targets records whose predicate is FALSE, or derive the field in a `beforeUpdate` hook on the target object (a hook-written value is not caller-supplied and does land).

A static-`readonly` counterpart is deliberately **not** shipped: an elevated action write lands on such a field, so the finding would state a falsehood and, at the hook rule's `error` grade, would gate a build over working code.

Wired through `REFERENCE_INTEGRITY_RULES`, so it runs on `os validate`, `os lint` and `os compile` at once. It reuses the existing machinery rather than adding any: `buildReadonlyIndex` from the flow rule for the field metadata, and `collectActionBodies` from the action rule for the body walk (both registration sites, with the merged-action de-duplication that walk owns).

`ctx.record` is excluded from the match set, and that exclusion is the rule's load-bearing decision: an action's `ctx.record` is a dead snapshot the runtime never writes back, so no readonly strip is ever consulted on it and a readonly verdict there would be false on every occurrence. `action-record-write-discarded` already owns that shape and states its real reason. Also skipped, each for a stated reason: `insert` / `create` (INSERT is exempt from both strips), `ctx.input` writes (an action's `ctx.input` is its params bag), dynamic object names, non-literal payloads, objects this stack does not declare, fields the object does not declare, and `id` in an `update` payload (the row address, not a field write).
