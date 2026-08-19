---
"@objectstack/metadata-protocol": patch
---

`auditMetaItem` no longer reports a failed audit read as an empty audit trail

The `catch` closing the audit read in `ObjectStackProtocolImplementation.auditMetaItem`
was unqualified. Its comment named two benign causes — the `sys_metadata_audit` table not
being provisioned (legacy environments) and a host engine that exposes no `find` — but the
clause took every other cause with them: a connection drop, a permission denial, a
timeout, a malformed row, a query bug. Each was reported to the caller as the well-formed
statement `{ events: [] }`, i.e. "this item has no audit entries".

This is the compliance surface behind `GET /api/v1/meta/:type/:name/audit`, which exists
so Studio's audit-log tab can show who tried what and whether a lock blocked it, so an
empty answer reads as *nobody touched this item*. Because the swallowed failures are
transient, the same item could report a full trail one minute and a clean one the next.

Both benign causes still answer `{ events: [] }` exactly as documented. Every other read
failure now raises `SERVICE_UNAVAILABLE` / 503 carrying the driver error as `cause`, which
the route's existing error handler turns into an honest 5xx — the same treatment the
sibling `listCommits` and `getMetaItem` reads in this package already give (ADR-0110 D3: a
miss and a fault are different facts).
