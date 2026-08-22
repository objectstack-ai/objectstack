---
"@objectstack/metadata-core": minor
"@objectstack/objectql": minor
"@objectstack/service-messaging": minor
---

**BREAKING (accept-set tightening)**: a by-id `update`/`delete` whose `options.where` carries predicate keys beyond `id` is now refused loudly instead of silently dropping the predicate (#11009).

The by-id dispatch routes to `driver.update(object, id, …)` / `driver.delete(object, id, …)`, which bind ONLY the primary key — every other `where` key was discarded with no diagnostic. A compare-and-set written as `{ where: { id, status: { $in: [...] } }, multi: false }` therefore evaluated to nothing and the write landed unconditionally, reading exactly like a working conditional write. Measured on `better-sqlite3` through a real `ObjectQL` + `SqlDriver`: `SqlHttpOutbox.redeliver`'s terminal-status guard was inert, so a delivery row claimed `in_flight` mid-redeliver was reset anyway and the redelivery reported success while the in-flight attempt kept running.

What changes, per call shape (`resolveEngineUpdateDispatch` / `resolveEngineDeleteDispatch`, so every pinned test double inherits the same verdicts):

- A `where` naming a scalar `id` **and nothing else** is unchanged — by-id, with or without `multi: true` (the `LifecycleService` guarded-reap idiom keeps its per-record cascade path).
- A `where` carrying a scalar `id` **plus other keys**, with a declared `multi: true` (id sourced from `where`): now routes to the **predicate path** (`driver.updateMany` / `driver.deleteMany`), which compiles EVERY `where` key — the compare-and-set spelling. Previously this dispatched by-id and dropped the extra keys.
- The same shape **without** `multi: true` — and any by-id call via a scalar `data.id` beside extra `where` keys, `multi` or not (the payload id outranks `multi` per #5748 and cannot be demoted onto the predicate path): now **throws**, naming the keys the by-id path would have dropped. Previously it succeeded with the condition ignored.

A caller hitting the new refusal decides which of two things it meant, and each is a one-line edit at the call site: declare the predicate path (`multi: true`) so the full `where` is honoured and the result is the matched count, or drop the extra `where` keys to keep an unconditional single-row write. Flow authors reach this through `update_record` / `delete_record` nodes whose `filter` names `id` plus other keys without declaring `multi` — those configs were silently unconditional before and refuse loudly now.

`SqlHttpOutbox.redeliver` itself now rides the predicate path, and `MemoryHttpOutbox.redeliver` re-checks terminal status after its guard, so both `IHttpOutbox` implementations agree: a row claimed between redeliver's read and its write is NOT reset, and `redeliver` reports `DELIVERY_NOT_ELIGIBLE` instead of success.

<!-- adr-0087: not-required (no-migration-prescription) No authorable surface is removed or renamed — no spec key, no export, no config field changes spelling, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could serve an upgrader. The newly-refused call shapes were silently broken before this change (their declared condition was never evaluated); the refusal text itself names the two call-site choices, and choosing between them is a per-site intent decision (conditional vs unconditional write) that a mechanical rewrite must not make. -->
