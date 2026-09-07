---
'@objectstack/metadata-protocol': patch
---

Serve an Invalid `Date` from a driver instead of raising `RangeError` at two metadata read seams.

`canonicalIsoInstant` (`sys-metadata-repository.ts`) and the `occurredAt` arm inside `auditMetaItem` (`protocol.ts`) both reached `value.toISOString()` for any `Date`. That call raises `RangeError: Invalid time value` for the one `Date` whose time value is `NaN`, so a single bad row answered **500** on a read path — where the spelling these repairs replaced, `String(value)`, had served a visibly-wrong field the caller could see and report.

The shape is measured, not hypothetical: mysql2 3.23.1 returns a module constant literally named `INVALID_DATE` for a zero `DATETIME`, and postgres-date 1.0.7 builds `new Date(NaN)` for every year in 275760..294276 — a range Postgres itself stores. Legacy imports, hand migrations and a MySQL database shared with another application are all ordinary ways such a row arrives.

Both arms now guard on `Number.isNaN(value.getTime())`, and the terminal value is chosen per call site rather than uniformly:

- `canonicalIsoInstant` answers `undefined`, so each caller's existing `?? <default>` chain — the branch an absent column already takes — keeps its meaning. Its consumers are machines, and one forwards into a `z.string().datetime()` field that visible text would fail.
- `auditMetaItem`'s `occurredAt` falls into the `String(...)` arm already beside it, which renders exactly `"Invalid Date"`. `AuditMetaItemResponseSchema.events[].occurredAt` is a required plain `z.string()` read by an operator in Studio's audit tab, so the text satisfies the contract and one bad row no longer blanks the page.

Neither answer is a blank: a silent empty value is the shape that hides the producer's bug.
