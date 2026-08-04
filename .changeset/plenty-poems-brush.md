---
'@objectstack/metadata-protocol': patch
---

seed-loader: a pass-2 back-fill dropped for a missing source-record id is now reported, not silently discarded

`resolveDeferredUpdates()` looked the source record's internal id up in `insertedRecords`
and, when it was not there, ran off the end of an `if` with no `else`. Pass 2 had already
RESOLVED the target, and the back-fill then evaporated: no write, no entry in
`errors`/`allErrors` (so the load still reported `success: true`), no `errored`, and not
one log line. The only trace was the `referencesDeferred` the record booked in pass 1 and
never gave back — a dangling number with nothing in the result explaining it, while the
declared association stayed absent forever.

It now records the loss through `recordDeferredError` (→ `errors`/`allErrors` + `errored`,
so the load reports `success: false`) and logs it once at `error`, per the same objective
criterion applied in #4729/#4997 and the "Degradation log levels" rule. The two ways to
get here are worded differently because they are different failures: an EMPTY
`recordExternalId` — `externalIdKey` returns `''` when any component of a composite
externalId is blank — is the pure silent loss, where the row wrote perfectly, nothing else
in the load reports anything and the reference stays NULL forever; a real key that is
simply absent from the map means the source row never landed, and that write failure was
already reported at `error`, so this line points at it instead of restating it.

A load that hits this path previously returned `success: true` with clean counters and now
returns `success: false` with the loss counted — the seed data was always incomplete; it
just was not saying so.
