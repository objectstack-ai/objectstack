---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a runtime permission-set save refuses a grant on an object that does not exist

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**BREAKING** for one shape only: a `permission` set whose `objects` map grants on an object this runtime does not know. It was stored and published (200), and the grant applied to nothing, because the permission evaluator keys a grant by the object's name: a short `lead` where the object is `crm_lead` silently granted nothing. `defineStack` already refuses the same grant at build; the metadata save doors now refuse it too.

- **Where.** `PUT /api/v1/meta/permission/NAME`, live and `?mode=draft`; the publish of a draft (`POST /meta/permission/NAME/publish`, `POST /packages/ID/publish-drafts`); and the restore doors (`POST /meta/permission/NAME/rollback`, a commit revert).
- **The refusal.** `422 INVALID_METADATA`, the save door's existing envelope, with one finding per unknown object at `objects.NAME`: "Permission 'SET' grants on object 'NAME' which is not defined in objects: …". Nothing is stored; a package publish aborts the batch.
- **What counts as known.** The `'*'` wildcard; an object the runtime registers, from any package, platform objects (`sys_*`, the RBAC link tables) included; an object stored in this environment or defined in code; on a draft save, any object draft; on a package publish, an object drafted in the same batch.
- **What is not judged.** A grant the set already holds: a re-save, `os migrate meta --stored` or a restore that keeps it is not refused, even if the object has gone since. Editing a shipped set is therefore never refused for a grant it ships with.
- **What to do.** Correct the object name to the object's full name, create the object first (or draft it in the same package), or remove the grant.

<!-- adr-0087: not-required (no-migration-prescription) the diff registers no retirement and prescribes no rewrite: the refused value granted nothing, so there is no stored shape to convert; a set that already holds such a grant is not refused on re-save -->
