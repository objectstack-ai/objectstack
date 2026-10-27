---
'@objectstack/spec': patch
---

fix(spec): `os lint` tells an author that a field's `externalId: true` does nothing

Clause-②: no (a liveness-ledger re-grade: no schema, accept set, served body or error code moves; only the advisory `liveness-dead-property` warning on an authored `externalId: true` starts, and the flag's description is reworded)
Metadata-protocol: none

The shipped liveness ledger (`liveness/field.json`) graded a field's `externalId` flag `live` on the strength of one renderer module that was deleted for having no importers. Re-measured across `packages/**` and `ui/**`, nothing reads the flag: the Studio field inspector edits it and a metadata summary copies it, and no upsert matches on it. The row is now `dead`, so `os lint` warns on a field that sets `externalId: true` (the default `false` is not warned). The flag's schema description, and the reference pages generated from it, no longer say it drives upserts.

- **What to do.** Remove the flag. To match seed records on a field, name the field in the seed dataset's `externalId` (`name` when it is left out). For an import, name it in the mapping's `upsertKey`.
- **Unchanged.** Parsing (the key is still accepted, default `false`), seed loading, imports and every upsert.
