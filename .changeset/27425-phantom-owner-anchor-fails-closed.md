---
'@objectstack/plugin-sharing': patch
'@objectstack/lint': patch
---

fix(plugin-sharing)!: on a federated object whose `owner_id` is the platform's injected anchor, the read and bulk-write scopes narrow below `org` instead of going unscoped (#27425)

Clause-②: no (narrowing) — `SharingService.buildReadFilter` and `buildWriteFilter` answer a deny-all scope, where they answered `null` (no scope), for a caller below `org` depth on an ADR-0015 federated object that neither declares `owner_id` in `fields` nor maps a remote column onto it; on `private` such an object's refused edit answers 404 where it answered 403. Nothing is widened and no key is added, removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the record-sharing scope of one class of federated object fails closed where it went unscoped. The remedy is a metadata choice the author already has (declare the owner column, or choose the sharing model on purpose), so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** read-scope narrowing in record sharing (`@objectstack/plugin-sharing`).

- **Before.** On a federated object (`external` binding) with an owner-keyed sharing model, the sharing service decided whether `owner_id` was real from the declared `fields` alone. When the author had not declared it, the registry's injected anchor was taken to mean "no owner column", and the read filter applied no scope. A driver can still serve `owner_id` (the SQL driver through `external.columnMap`, a remote column of that name, a plugin driver on its own), so a `private` object answered its rows to members it was meant to hide them from. Bulk updates and deletes went unscoped the same way, while single-record writes were refused with 403.
- **Now.** The owner column counts as proven when `fields` declares `owner_id` or an `external.columnMap` entry maps a remote column onto it; such an object keeps ordinary owner scoping (a driver that does not apply the map serves no `owner_id`, so the owner predicate admits nothing there). Otherwise an unproven owner narrows the scope: below `org` read depth the read filter admits no row by ownership, no owner predicate and no share rows (a grant on such an object is already refused as inert), and a pending approval step still opens the record it waits on. The bulk write filter admits no row below `org` write depth. Because an edit reads its record through the same scope first, a member's PATCH on a `private` object of this shape now answers 404 `RECORD_NOT_FOUND` where it answered 403 `PERMISSION_DENIED`; on `public_read` it stays 403. `org` depth, the Modify All bypass, system callers and local objects are unchanged.
- **Who sees it.** An app with a federated object on `private` (including no `sharingModel`, which the runtime treats as `private`), or `public_read` for bulk writes, that neither declares nor maps `owner_id`: members below `org` depth now read no row there, and their refused edits answer 404. An external principal on a `public_read` object meets the same closed scope. `os validate`'s `security-external-owner-unmapped` warning (`@objectstack/lint`) now names the 404 on `private`, and its explanation says reads are refused too.

**The remedy.** Choose on purpose. Declare `owner_id` in `fields` and have the driver return the remote owner under that name (a built-in SQL driver through `external.columnMap`; a plugin driver must return it itself), and the object scopes to the owner. Or choose `sharingModel: 'public_read'` (everyone reads) or `'public_read_write'` (everyone reads and edits, a `beforeUpdate` hook decides who may).
