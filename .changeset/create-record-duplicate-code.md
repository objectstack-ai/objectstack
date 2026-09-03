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

Additive only — no existing field, message text or routing behaviour changes; an executor that never sets `code` (every one except `create_record` today) is unaffected. Deliberately scoped to `create_record` alone: `update_record` / `delete_record` collapse the same way, but `engine.update` still leaks the raw driver error (#14390, not yet fixed), so those node results have nothing structured to surface yet. `create_record` itself forwards `code` only when it equals `DUPLICATE_RECORD` — narrowly, on purpose, matching the ADR-0112 vocabulary member this repair was actually scoped to surface, not any code an as-yet-unaudited driver error might someday carry.

**Patch round 1 (tier contract review):** `try_catch`'s catch region reads `code` off the run-wide `$error`, but the engine only rewrites `$error` when a failing node *returns* a failure, or *throws* through a node with its own `fault` edge — and a node inside a `try_catch`'s `try` region never has one (the region's synthetic sub-flow carries only the region's own edges). A node that fails by throwing (a `timeoutMs` firing, a dying nested container) therefore used to leave `$error` exactly as an *earlier, unrelated* failure left it — its `code` included. An identity guard (`$error` must have *changed*, not merely still be present, since this attempt started) closes that; two flows now pin it: a `loop` sweeping two rows where row 1 is a genuine duplicate and row 2 times out, and a plain flow where an earlier fault-routed duplicate must not leak into a later, unrelated `try_catch`.

A custom `IDataEngine` implementation whose thrown error already carries `code: 'DUPLICATE_RECORD'` (without being an instance of `@objectstack/objectql`'s `DuplicateRecordError`) is treated as a duplicate too — correct under ADR-0112, since `code` is the classified envelope's public contract, not the concrete class.

**Known gap, filed rather than fixed here (out of this lane's scope):** `packages/spec`'s `TryCatchErrorValueSchema` — the ONE declared shape for the `errorVariable` binding shared by author, engine and run log — does not declare `code` yet, and strips it on a strict parse. `packages/spec` is single-owner (`domain:spec`); tracked as #14954.

<!-- adr-0087: not-required (no-migration-prescription) additive optional field; no authorable key, export removal or rename for an upgrader to migrate -->
