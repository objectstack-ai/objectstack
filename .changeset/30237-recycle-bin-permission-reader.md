---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/core': patch
'@objectstack/objectql': patch
'@objectstack/verify': patch
---

feat(security): the recycle bin's two grants are read: `restore` asks `allowRestoreOwnDeleted` and `purge` asks `manageRecycleBin`, and a member restores only the entries they deleted

Clause-②: yes (widening)
Metadata-protocol: none

Until now every `restore` and `purge` dispatch was refused for every caller but the system, whatever the caller's permission sets granted. The two recycle-bin keys on an object permission are now read (ADR-0148 D5):

- **`allowRestoreOwnDeleted`** answers `restore`. It restores only the entries the caller deleted: restoring an entry someone else deleted is refused `403 PERMISSION_DENIED` unless the caller holds `manageRecycleBin` on the object. When the platform cannot tell what the caller holds, that restore is refused.
- **`manageRecycleBin`** answers `purge`: purging one entry, emptying an object's entries, and the permanent delete (`delete(…, { permanent: true })`). It also restores any entry, not only your own.
- **How the keys fold**: each is bounded by read; `modifyAllRecords` implies both; `manageRecycleBin` implies `allowRestoreOwnDeleted`; `allowDelete` implies neither. `objectPermissionGrants` (`@objectstack/spec/security`) answers both keys this way, and `/me/permissions` reports them.
- **The tenant wall on the bin**: a caller the organization wall denies (for example, signed in with no active organization on a multi-organization deployment) now sees no entry: `restore` answers `null`, `purge` answers `false` and `empty` answers `0`. Before, such a caller's `purge` and `empty` were not scoped to any organization. The removal is scoped by the verdict the security layer recorded on the dispatch when it recorded one.
- `@objectstack/verify`: a write observer now also sees `purge` and `restore`.

Grant `allowRestoreOwnDeleted` (with read) to the people who should take back what they deleted, and `manageRecycleBin` to the people who administer the bin. Nothing changes for a caller who holds neither.
