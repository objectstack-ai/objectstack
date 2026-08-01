---
'@objectstack/spec': minor
---

The six `validation` rule variants reject unknown keys, each against its own key set, and the type can finally represent its ADR-0010 protection envelope.

`validation` was the registered metadata type this campaign kept deferring: a `z.lazy()` discriminated union whose six variants each `.extend()` a shared base, so the one-call `strictObject` conversion the other types took does not apply.

**Why not just close the base.** `.extend()` inherits strictness, so closing `BaseValidationSchema` alone would have rejected unknown keys correctly — but the error map closes over the key list it was *built* with, which for the base is only the shared keys. A typo of a variant's own key (`transtions` for `transitions`, `formuIa` for `formula`) would have been rejected with no rename offered, which is the difference between a fixable error and a confusing one. The union discriminates on `type`, so an author is always on exactly one variant and that variant's full key set is the right candidate list. The base is now a named shape spread into six `strictObject` calls, each with the aliases that fit its own vocabulary.

**The envelope.** `validation` is a registered metadata type, so `MetadataPlugin`'s loader stamps `_packageId` / `_provenance` on it and `getMetaItemLayered` → `saveMetaItem` round-trips a body carrying them — and the schema could not represent them, so they were dropped on every parse. Declared once in the shared shape, so all six variants inherit it, and the type comes off the debt list in `kernel/metadata-type-schemas.test.ts` (that list carries a reverse pin, so removing an entry is forced rather than optional).

Authoring impact: a key none of the variants declares is now rejected instead of silently discarded — it was already being ignored, so no working behavior changes. The rejection names which variant it landed on ("this state-machine validation rule"), echoes the key, and suggests the closest declared one from that variant's full set.
