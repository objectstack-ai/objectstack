---
"@objectstack/runtime": minor
---

fix(runtime): tell an action handler when its caller-scope record load was refused (#14143)

Both action doors load the subject row under the **caller's** own execution
context, and both then stamp the requested id back onto the record:

```ts
if (record && record.id == null && recordId) record.id = recordId;
```

A refused or empty load leaves `record` as `{}`, so `record.id` is exactly
`null` — which is the stamp's own condition. The stamp condition and the
load-failure condition **coincided**. An action body runs elevated
(`isSystem: true`, settled design — #3914), so authorization has to be
re-established inside the handler, and the predicate every author reaches for
first was therefore always false:

```js
if (!ctx.record?.id) return refuse();   // never refused anything
```

An app author had to rediscover this by reading the dispatcher, or ship a guard
that passes on a row the caller cannot see. Undocumented, and identically broken
on both invocation paths.

**The addition: `ctx.recordLoadDenied`.** `true` exactly when a caller-scope
load was **attempted** and did not deliver the row; **absent** — never `false` —
otherwise, matching the `referentialFieldClear` marker convention on the same
seam, so a handler reads `ctx.recordLoadDenied === true`.

```js
if (ctx.recordLoadDenied) {
  throw Object.assign(new Error('Record not available'), { code: 'RECORD_NOT_FOUND' });
}
```

- **Purely additive.** Nothing is refused that was not refused before, no
  existing key changes value, and the `recordId` stamp is deliberately
  **kept**: new-record / record-less actions depend on it, so `ctx.record.id`
  still arrives exactly as it did. Pinned in both directions.
- **Both doors, one producer.** REST `POST /api/v1/actions/...` and the MCP
  `run_action` bridge now share `loadActionSubjectRecord`. A signal only one
  door emitted would be an authorization guard silently inert on the other.
- **The body face too.** The sandbox `ctx` is a fixed key set, so the flag is
  marshalled explicitly into the VM — an inline `body` (the surface an AI author
  writes most) reads it exactly as a registered handler does.
- **Documented**, in `docs/ui/actions` ("Authorization inside an action") and
  from the action-`ctx` section of `docs/automation/hook-bodies` — half the
  defect was that none of this was written down anywhere.

**What the flag does not claim.** It reports "the row did not resolve for this
caller", not "the platform caught an authorization error". A row hidden by
row-level security and an id that names nothing both arrive as
`RECORD_NOT_FOUND` / 404 — existence non-disclosure working as designed — and
nothing in the caught error separates them, so the flag carries no code or
status and does not pretend to. For an authorization decision the two are one
answer: this caller has not demonstrated read access to that row.

The `isSystem` elevation itself is unchanged and is not the defect (#3914); no
call that reaches a handler today stops reaching it.
