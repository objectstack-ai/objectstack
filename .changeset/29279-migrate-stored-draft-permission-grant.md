---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the stored-metadata healing pass re-saves a draft-only permission set that grants on an object which exists nowhere now, instead of reporting it `failed`

Clause-②: yes (widening) — `migrateStoredMetadata` (`os migrate meta --stored --apply`, `POST /api/v1/meta/_migrate-stored`) now rewrites a draft-only permission set whose stored body needs a conversion and whose grant names an object with no active row and no draft; it reported that row `failed` with the unknown-grant `422`. Every author-facing save, publish and restore door judges the grant as before.
Metadata-protocol: none

- **Before.** The save door's unknown-grant refusal skips a grant the set already holds, read from the set's active row. A set that is only a draft has none, so the pass re-saving its own draft (for example to strip the retired `managedBy` key) was refused once the object draft it granted on had been discarded, and the legacy key stayed at rest.
- **Now.** A `migrate-stored` re-save is not judged for unknown grants, as it already is not for a seed's keyed field: it rewrites a row the store already holds. A draft stored before the rule is refused at its publish, as any other publish of it is.
- **Wording.** At a draft's publish the finding now says what the publish looked for: "no package registers an object of that name, and no published object, or object draft of this batch, carries it". The save door's sentence, the finding path and the leading "Permission 'SET' grants on object 'NAME' which is not defined in objects" are unchanged.
