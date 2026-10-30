---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a datasource saved through the metadata door may name only the credentials reference its own stored row holds (#27762)

Clause-②: no (narrowing) — the metadata save door refuses a `datasource` body whose `external.credentialsRef` is not the reference its own stored row already holds, where it stored the value as given before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: `DatasourceSchema` keeps `external.credentialsRef` authorable, and the save door refuses one value of it, a reference the save's own stored row does not hold. A stored row is never re-judged: it is read and served as before, and a save that sends its reference back keeps it. There is nothing for a migration to rewrite and no tombstone; the remedy is a door, the datasource admin door's `secret`, which the refusal names. -->

**BREAKING** accept-set narrowing on the metadata save door (`saveMetaItem`: `PUT /api/v1/meta/datasource/:name`, the runtime dispatcher's `/meta` door, MCP and in-process saves), the rule #27582 set for `secret` fields and #27722 applied to the datasource admin door's create: a non-system write may only seal a new value or keep its own record's stored reference.

- **Before.** A `datasource` body's `external.credentialsRef` was stored as given.
- **Now.** A save may name only the reference its own stored row already holds. A create (no stored row), an edit naming another reference or naming one where its row holds none, and a draft naming one the active row it overlays does not hold, are refused with `VALIDATION_ERROR` / `400` before anything is written. The message names the key and never the value, and the answer is the same whatever the value names. The package copy and the unmanaged import, which save new rows through the same door, are judged the same way.
- **Unchanged.** The GET → edit → PUT round trip, which sends back the reference the read serves, keeps it. A body that names no reference saves as before. The server-stated rewrites (`source` set, the stored-metadata migration) keep their pass-through. Rows already stored are not re-judged.
- **Who sees it.** A caller of the metadata save door that writes a datasource's `external.credentialsRef` by hand. The Console's datasource page saves through the datasource admin door, which this does not change.

**The remedy.** Send back the reference a read of the datasource serves, or omit the key to save it with no credential bound. To bind a credential, send the secret to the datasource admin door (`POST /api/v1/datasources`, or `PATCH /api/v1/datasources/:name`), which mints and stores the reference.
