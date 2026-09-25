---
'@objectstack/plugin-security': patch
---

fix(plugin-security): `security/explain` computes a record's `update` / `delete` verdict from the by-id write path's own inputs, so `record.visible` matches what the by-id PATCH / DELETE does (#19963)

Clause-②: no

`POST /api/v1/security/explain` with `{ object, operation: 'update' | 'delete', recordId }` answered `decision.record.visible: false` (`decidedBy: 'rls'` or `'sharing'`) on rows that the by-id `PATCH` / `DELETE /api/v1/data/{object}/{id}` then admitted for the same caller. It happened on every object whose OWD is private (set explicitly, or left unset). A console that gates Edit on `record.visible` hid Edit and inline edit from users who were allowed to edit. Two inputs differed from the write path:

- **The platform ownership floor.** The by-id write gate drops `owner_only_writes` / `owner_only_deletes` (`created_by == current_user.id`) when the sharing service answers `allow` for the row. Explain kept the floor, so it excluded every row the caller did not create. That covers a row shared to them with `edit` access, a row they own but did not create, and a row an `org`-depth writer may edit.
- **The write depth.** The write path hands the sharing service's per-record gate (`canEdit` / `canDelete`) the caller's effective write depth. Explain asked the same gate without it, so a caller with `org` or unit write depth was judged owner-only.

Explain now asks the same floor decision the write gate asks. It also passes the same write depth to the per-record gate.

Unchanged:

- Enforcement: the by-id write gate admits and refuses exactly what it did before. Its floor decision moved into one method that both paths call.
- Reads (`operation: 'read'`) and object-level explanations (no `recordId`).
- A caller acting on behalf of another user (`onBehalfOf`): its record-level write explanation uses the same inputs as before.
- Objects whose OWD is `public_read_write` already matched and still do.
