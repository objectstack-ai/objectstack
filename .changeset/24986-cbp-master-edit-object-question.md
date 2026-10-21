---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a `controlled_by_parent` detail write asks its master the object-level question the master's own write door asks (ADR-0055 §3)

Clause-②: no

ADR-0055 §3 says editing, deleting or creating a detail requires edit access to its master. The master-edit gate's object-level leg asked only for an object-level `update` grant on the master. It now asks what the master's own write door asks of an `update` on the master, with that door's inputs: the master's security posture must resolve, the capabilities the master requires for `update` (ADR-0066 D3) must be held, and the grant is asked under the master's posture (ADR-0066 D2). A principal the master's own write door refuses at its object gate can no longer write a detail under that master.

- **Every door that asks the leg.** An insert, a by-id update and a by-id delete of a detail answer `PERMISSION_DENIED` (403) and write nothing. `checkControlledByParentWrite`, which the comment and attachment parent gates ask, answers `deny` on the `object_permission` leg. A record-grained `security/explain` of a by-id write follows the same leg.
- **An insert answers before the reference check.** For such a principal, an insert under a master id that exists answers the same refusal as one under an id that exists nowhere. A principal that also cannot read the master, on an on-behalf-of write too, now gets this `PERMISSION_DENIED` on insert where it got the reference check's `VALIDATION_FAILED`. An insert under a master object that does not resolve answers `PERMISSION_DENIED` where it answered `OBJECT_NOT_FOUND` (404).
- **Unchanged.** A principal the master's own write door admits for an `update` keeps writing its details, and so do a super-user grant and a system context. Under a master that is `public`, resolves and requires no capability for `update`, every principal gets the answer it got before.
