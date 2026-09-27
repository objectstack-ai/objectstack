---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security/explain` asks the sharing read filter with the caller's read depth, so a record's `read` verdict matches what the caller's `find` returns (#19986)

Clause-②: no

`POST /api/v1/security/explain` with `{ object, operation: 'read', recordId }` answered `decision.record.visible: false` (`decidedBy: 'sharing'`) on rows that the same caller's `find` returned. It happened on every object whose OWD is private (set explicitly, or left unset), for a caller whose read depth is wider than `own`. The find path hands the sharing service's read filter the caller's effective read depth. Explain asked the same filter without it, so a caller with `org` read depth was judged owner-only on every row it did not own, and a caller with unit read depth was judged owner-only on rows its unit owns.

Explain now passes the same read depth, computed the way the find path computes it. A read depth already present on the explained context no longer decides the report.

Unchanged:

- Enforcement: `find` admits and refuses exactly what it did before.
- Writes (`update` / `delete`) and object-level explanations (no `recordId`).
- A caller acting on behalf of another user (`onBehalfOf`): its record-level read explanation uses the same inputs as before.
- Objects whose OWD is not private already matched and still do.
