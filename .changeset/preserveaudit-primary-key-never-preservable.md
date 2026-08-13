---
'@objectstack/objectql': patch
---

`preserveAudit` no longer reinstates a record's own primary key (#8215). `isPreservableUnderAudit` now excludes `id` before consulting the whitelist, so a historical-import (`preserveAudit`) by-id update stops handing `SET id = 'rec_1' WHERE id = 'rec_1'` to the driver — a write that is a no-op on SQL but an outright rejection on stores with immutable primary keys. The REST ingress folds the path id into every update body, so bulk historical imports hit this without ever sending an `id` themselves. The flag keeps doing its actual job: the audit/timestamp family and author-declared business `readonly` fields (`closed_at`, `resolved_by`, …) are still preserved. On the insert side the shared predicate now also strips a caller-seeded `autonumber` primary key under `preserveAudit`; business `autonumber` identifiers (`account_number`, …) remain preservable.
