---
'@objectstack/objectql': patch
---

fix(objectql)!: the in-process engine refuses a projection whose every column is unknown, as it refuses an empty one (#27165)

Clause-②: no (narrowing) — `ObjectQL.find` / `findOne` refuse a `fields` list naming only columns the object does not have, which they read before as every column. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the engine already refused an empty projection, and a projection that its unknown-column tolerance empties is now judged the same way. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the in-process read entry (`@objectstack/objectql`).

- **Before.** `find` / `findOne` drop a requested plain column the object does not have. When that left nothing, they fell back to every column: `engine.find(object, { fields: ['nope'] })` answered every column, owner, organization and audit columns included, and the caller was not told. The REST door refuses the same request.
- **Now.** That case is an empty projection and gets the empty projection's refusal, before any driver read: `status: 400`, `code: 'VALIDATION_ERROR'`, the declaration's words (`Name at least one field`), and the message names the columns that were asked for.
- **Unchanged.** A mix of known and unknown columns still projects the known ones and drops the rest. An absent or `null` `fields` still reads every column. A host whose object has no registered field map is not judged.
- **Who sees it.** A plugin, hook, flow or other in-process caller whose projection names only columns the object lacks, for example a typo or a column from another object. No in-repo caller does.

**The remedy.** Name at least one column the object has, or leave `fields` out to read every column.
