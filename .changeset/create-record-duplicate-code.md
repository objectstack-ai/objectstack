---
"@objectstack/service-automation": patch
---

fix(automation): `create_record` now surfaces the engine's `DUPLICATE_RECORD` code, so a `try_catch` / `fault` edge can finally tell "already there" from "the store is down" (#14419)

`engine.insert` (#14095) already raises `DuplicateRecordError` — `code: 'DUPLICATE_RECORD'` (ADR-0112) — for a unique-constraint violation, driver-independent. The `create_record` node executor threw that away: every failure, from a duplicate key to a downed connection, collapsed into one opaque string (`create_record(<object>) failed: <message>`). A flow's only two error-handling primitives, `try_catch` and a `fault` edge, saw the same shape either way — the only expressible reading of "swallow the duplicate" was "swallow everything".

`NodeExecutionResult` gains an optional `code?: string` field, beside the existing `errorClass`, set when the caught error carries the platform's classified `DUPLICATE_RECORD` code. `AutomationEngine` now copies it onto the `$error` run variable alongside `message` (both the direct `fault`-edge path and the `try_catch` catch-region binding, which previously reconstructed `errorVariable` from the caught exception's message alone and silently dropped it), so a flow can actually branch on `{$error.code}`:

```
try:   create_record(lead, { email })
catch: { $error.code === 'DUPLICATE_RECORD' } → swallow, continue
       else                                   → re-raise / route the fault edge
```

Additive only — no existing field, message text or routing behaviour changes; an executor that never sets `code` (every one except `create_record` today) is unaffected. Deliberately scoped to `create_record` alone: `update_record` / `delete_record` collapse the same way, but `engine.update` still leaks the raw driver error (#14390, not yet fixed), so those node results have nothing structured to surface yet.

<!-- adr-0087: not-required (no-migration-prescription) additive optional field; no authorable key, export removal or rename for an upgrader to migrate -->
