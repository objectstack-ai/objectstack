---
'@objectstack/spec': patch
---

fix(spec): `ObjectSchema.create()` and `defineSeed` no longer answer a short unknown key with an unrelated one

Clause-②: no
Metadata-protocol: none

The strict unknown-key refusal on every `strictObject` surface stopped offering a key of five characters or fewer a rename that is two unrelated edits away: such a key is answered only by a candidate one edit away, an adjacent swap counted as one. `ObjectSchema.create()` and `defineSeed` carried their own copy of the `max(2, len/3)` budget without that screen, so they went on answering, for example, an object key `page` with `name` and a seed key `kind` with `id`.

All three now read one rename rule. A genuine one-edit slip is still answered (`nmae` → `name`, `labl` → `label`, `queeu` → `queue`), and keys longer than five characters keep the same `max(2, len/3)` budget; `ObjectSchema.create()` now also ranks its candidates the way the strict refusal does (case and separators folded on both sides, the author's own capitalisation breaking a tie). Only the "did you mean" text changes: no key is accepted or refused that was not before, and no export is added or removed.
