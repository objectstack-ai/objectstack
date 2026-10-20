---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a seed replay no longer rewrites every seeded row that carries a password or secret field on every boot

Clause-②: no (a replay comparison: no accept set, served body or masking verdict moves; the loader takes no new read and never sees a stored credential)

- **What changed.** A replay reads the existing rows through `engine.find`, which serves a set `secret` field, and a set `password` field on an object not managed by better-auth, as `SECRET_MASK` in every context (ADR-0100). The replay compared the seed's plaintext with that mask, read the row as changed and rewrote it on every boot: `updated_at` moved, lifecycle validation ran again and history could record an edit nobody made. A field the object declares masked on read (asked of `isMaskedOnReadFieldType`, the same declaration the engine's own mask reads) now never blocks the skip while the existing row reads back the mask.
- **What a seed author sees.** A seed change to ONLY such a field is not applied on replay. Change another field of the same row as well (the rewrite then writes the whole seeded record, the new credential included), or rebuild the database. Setting a credential on a row that has none, or clearing one, is still written: an unset credential reads back `null`, not the mask. A load that skipped a row without comparing a credential says so in one `info` line naming the fields and both remedies.
