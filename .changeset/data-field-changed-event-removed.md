---
'@objectstack/spec': major
---

**BREAKING**: `DataEventType` drops `data.field.changed` — it had no producer (ADR-0049 enforce-or-remove, #4673)

`data.field.changed` was declared in the `DataEventType` enum and emitted by
nothing. The engine's `publishDataEvent` sends `data.record.{created,updated,deleted}`
and (since #4639) `data.records.{updated,deleted}`; no other producer exists in
either repository. A subscriber that switched on `data.field.changed` held a
branch that could never run — and because the surrounding `switch` still
compiled, nothing ever reported the gap. That is ADR-0078's silently-inert
declaration, on the event vocabulary.

It also could not have been implemented against this contract as written:
`DataEventSchema` is record-shaped (`recordId`, `changes`, `before`, `after`)
with no `field` / `oldValue` / `newValue` slot, so the member advertised a
granularity the payload has no room for.

**FROM → TO**

| FROM | TO |
| :--- | :--- |
| `type: 'data.field.changed'` | `type: 'data.record.updated'`, reading the per-field detail from the payload's `changes` map (with `before` / `after` for surrounding state) |

**The one-line fix** — delete the dead branch and read `changes` off the update
event:

```ts
// BEFORE — never ran; no producer ever sent this event
if (event.type === 'data.field.changed') { onFieldChange(event); }

// AFTER — the changed fields have always ridden on the record event
if (event.type === 'data.record.updated') {
  for (const [field, value] of Object.entries(event.changes ?? {})) onFieldChange(field, value);
}
```

Removing that branch changes no observable behaviour — it never executed — so
this is deleting code that could not run, not rebuilding a capability. Note the
replacement is one event per write rather than N events on a wide table.

**The retirement kit:**

- **Schema** — the member is gone from `DataEventType` (`api/events.zod.ts`),
  with an in-schema comment recording what was removed and what the live
  mechanism is. Deliberately **no `retiredKey()` tombstone**: a removed enum
  VALUE cannot carry a fix-it prescription the way an authorable object key
  can (the same limit the sharing-rule `full` retirement hit). The enforced
  channels are `tsc`, which fails any consumer still naming the value in a
  `DataEventType` position, and the enum parse, which now rejects the name
  instead of accepting an event that never arrives.
- **ADR-0087 D3 semantic migration** — `data-field-changed-event-retired` in
  `migrations/registry.ts` (step 17), carrying the reason and acceptance
  criteria. Registered as a **semantic TODO rather than a D2 conversion**
  because this is a runtime EVENT surface: no stack, example or template
  authors an event name, so there is no source for `os migrate meta` to
  rewrite. (Webhooks subscribe through the separate authorable
  `WebhookTriggerType`, whose vocabulary was already trimmed to producers that
  exist, #3196.)
- **No liveness-ledger entry** — the ledger governs authorable metadata types
  (`object`, `field`, `flow`, …); `DataEvent` is a runtime payload contract and
  has no ledger file. `check:liveness` and `check:empty-state` pass unchanged.
- **No `authorable-surface.json` movement** — that ratchet tracks authorable
  *keys* (`api/DataEvent:type` and friends), not enum members, so the key list
  is unchanged and gates (a)/(b) correctly stay silent.
- **Tests** — `api/events.test.ts` pins the narrowed `.options`, asserts the
  retired name no longer parses, and pins the FROM → TO replacement (that
  `data.record.updated` really does carry `changes` / `before` / `after`).
- **Docs** — `content/docs/references/api/events.mdx` and
  `docs/protocol-upgrade-guide.md` regenerated.

If a genuine per-field change stream is ever wanted, it earns its own honest
contract — the precedent #4639 set for bulk writes — rather than reclaiming
this slot.
