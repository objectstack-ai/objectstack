---
'@objectstack/lint': minor
'@objectstack/spec': patch
'@objectstack/objectql': patch
---

feat(lint)!: `searchable-field-unsearchable` reports a `searchableFields` entry that names a `secret` or `password` field, which the engine leaves out of every search without a word

Clause-②: no (narrowing) — `os validate`, `os build`, `os lint` and the metadata publish door refuse a `searchableFields` entry whose field type is `secret` or `password`, on the object's own set, on every list view surface and on a react page's ListView `searchableFields` prop, which they accepted before. The finding takes the severity of the `formula`-entry finding (`error`). No rule id is added or removed.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a searchableFields entry the engine already withheld from every search (ADR-0100) is now refused where it is authored. The one remedy is to delete the entry, which a conversion cannot decide for the author, so there is no key for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at every authoring door for `searchableFields`.

- **Before.** The engine's search expansion leaves every credential column (`secret`, `password`) out of the set it scans (ADR-0100), an author-declared one included, and says nothing. A declaration naming one passed every gate and searched a narrower set than written; a declaration naming only credential fields fell through to the auto-default set.
- **Now.** The rule refuses the entry at `error`, naming the entry, its type and the object. It is judged on every object, a better-auth `password` included: the read mask spares that one, the search withhold does not.
- **Who sees it.** An object or list view whose `searchableFields` names a `secret` or `password` field. No metadata shipped in this repository does.

**The remedy.** Drop the entry: credential fields are never searched. `os explain searchable-field-unsearchable` states what the engine does with it on each surface.

`@objectstack/spec` exports `isCredentialFieldType(fieldType)` from `@objectstack/spec/data`: whether a field type is masked on read on at least one object (`secret`, `password`), the exemption-free question. `@objectstack/objectql`'s `collectCredentialFields` now reads it instead of its own type literal; its answer is unchanged.
