---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: the metadata save doors refuse an object whose `datasource` names a datasource that does not exist, instead of storing and publishing an object that never registers (#26724)

Clause-②: no (narrowing) — `saveMetaItem` (draft and live), the draft promotion behind `publishMetaItem` and `publishPackageDrafts`, and the restore doors (`rollbackMetaItem`, `revertCommit`) refuse an `object` whose `datasource` names no registered driver, no declared or stored datasource and no pending datasource draft, which they stored before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: `ObjectSchema.datasource` already names a datasource ID, and the door now refuses an ID that names none, which never worked. A stored object that already holds such a binding keeps re-saving; there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the metadata save and publish doors (`@objectstack/metadata-protocol`), served by `PUT /api/v1/meta/object/:name`, `POST /api/v1/meta/object/:name/publish` and `POST /api/v1/packages/:id/publish-drafts`.

- **Before.** An object saved with a misspelled `datasource` (`gapdata_nosuch`) was stored, and `publish-drafts` answered `outcome: 'published'`. The engine routes an explicit `datasource` to the driver of that name only, so the object never registered: every `/api/v1/data/:object` call answered 404 "not registered", with no pointer to the cause.
- **Now.** The save answers `422 INVALID_METADATA` with one finding at `datasource`: "Object 'NAME' names datasource 'DS', and no datasource of that name exists here: …". Nothing is stored. A draft stored before this is refused at its publish the same way, and a package publish then promotes nothing.
- **What exists.** No `datasource`, or `'default'`; a driver the engine has registered under the name (a `driver.*` service or an `onEnable` `drivers.register`, with no datasource item); a datasource item the code layer declares (`*.datasource.ts`) or this environment stores, connected or not; on a draft save, any datasource draft of that name; on a package publish, a datasource draft of the same batch.
- **Not judged.** A save, publish or restore that keeps the `datasource` the object already holds: the binding is not that write's. So `os migrate`'s re-saves, which never run `onEnable`, keep working for an object bound to a driver registered there.

**The remedy.** Correct the name, declare the datasource first (or draft it in the same package and publish both together), or remove `datasource` to use the primary datasource.
