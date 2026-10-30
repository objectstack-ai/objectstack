---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a datasource restored or published from a stored body may name only the credentials reference its row holds now (#27818)

Clause-②: no (narrowing) — the restore doors and the draft publish refuse a stored `datasource` body whose `external.credentialsRef` is not the reference the active row they write into holds now, where they wrote it back as stored before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: `DatasourceSchema` keeps `external.credentialsRef` authorable, and the doors that make a stored body active refuse one value of it, a reference the row they write into does not hold now. A stored row is never re-judged at rest: it is read and served as before, and only the write that would make it the active row is judged. There is nothing for a migration to rewrite and no tombstone; the remedy is a door, the datasource admin door's `secret`, which the refusal names. -->

**BREAKING** accept-set narrowing on the doors that make a stored body the active row, completing the rule #27762 applied to the metadata save door (the #27582 own-reference rule: a non-system write may only seal a new value or keep its own record's stored reference). These doors seal nothing, so the one reference the body they write may name is the one the active row holds now.

- **Before.** A history version brought back by `rollbackMetaItem` (`POST /api/v1/meta/datasource/:name/rollback`) or by `revertCommit`'s restore limb (`POST /api/v1/packages/:id/commits/:commitId/revert`), and a draft promoted by the per-item publish (`POST /api/v1/meta/datasource/:name/publish`) or the package publish, became the active row with whatever `external.credentialsRef` it was stored with.
- **Now.** Each is judged as an active write into the row it lands in, with the save door's judge: a body naming a reference that row does not hold now is refused with `VALIDATION_ERROR` / `400` before anything is written. The message names the datasource and the key, never the value, and the answer is the same whatever the value names. A rollback answers the refusal; a commit revert reports it per item in `failed[]`; a package publish aborts on it.
- **Unchanged.** A version or draft naming the reference the row holds now is written and keeps it. One naming no reference is written as it stands, with no credential bound, as a save omitting the key is. The save door's own rule and its server-stated pass-through are unchanged, and no server-stated restore or publish exists. Rows already stored are not re-judged at rest.
- **Who sees it.** An operator who rolls back or reverts a datasource to a version whose reference its row no longer holds, because the reference was rotated through the datasource admin door since, or because the version was stored before the save door judged the key: that restore is refused. An author who publishes a datasource draft after its active row's reference was rotated, or a draft stored before the save door judged the key: that publish is refused.

**The remedy.** For a refused restore, restore a version that names the reference a read of the datasource serves, or save the version's settings through the metadata door with the key omitted. For a refused publish, save the draft again with the key omitted, or discard it, then publish. Either way, to bind a credential, send the secret to the datasource admin door (`POST /api/v1/datasources`, or `PATCH /api/v1/datasources/:name`), which mints and stores the reference.
