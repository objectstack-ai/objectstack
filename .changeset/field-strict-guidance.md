---
'@objectstack/spec': minor
---

`field` rejects unknown keys, reusing the curated table that already knew which advice would be wrong.

`FieldSchema` carries more silently-stripped keys than any other shape in the spec, and it said so about itself for two releases. Two separate notes on the object — one on `accept`/`maxSize`, one on the five pruned governance keys — both state that a write "parsed clean and the key was silently stripped", and both name it the ADR-0104 failure class. Neither could do anything about it, because the object was not `.strict()`. This is the fix those comments wanted.

**The guidance is derived, not hand-written, and the reason is a bug the first attempt shipped.** `FIELD_KEY_GUIDANCE` in `data/authoring-key-lint.ts` is twenty-odd curated entries for exactly this surface — every one found in the wild, already held honest by a test asserting each `to` names a key `FieldSchema` really declares. A hand-written table beside it would be a second copy of the truth, and it immediately proved why that matters: the lint's table suppresses the suggestion for `pii` **because `pii` is three edits from `min`**. A bare edit-distance suggester answers a personally-identifiable-information key with *"did you mean `min`?"* — confident, wrong, about an unrelated concept. The hand-written pass did exactly that. `FieldSchema` now reads the table directly (`to` → alias, `why` → guidance).

Note what moved: the table is unchanged and still tested. Its *consumer* changed — the lint no longer reaches `field` now that the parse rejects first, so the same curation that powered a warning now powers a rejection. That is the intended end state for every entry in it.

Among what it carries, the two that matter most are the ones that read as protection and were not: `encryptionConfig` and `maskingRule` were pruned in 2026-06 because they "implied at-rest protection that never happened". An author who declared either had their field stored in plaintext exactly as if they had not, and heard nothing. The rejection now points at `type: 'secret'` and at `requiredPermissions` (ADR-0066 D3, enforced by the FieldMasker).

**A cycle the whole test suite passed through.** `shared/suggestions.zod` imports `FieldType` from `data/field.zod`, so adopting `strictObject` here closed a loop — field → strict-object → suggestions → field. Under `OS_EAGER_SCHEMAS=1` (how `build-schemas.ts` runs) every `lazySchema` body executes at module init, so the loader hit a half-initialized module and threw before a single schema was built. **284 test files and 7,239 cases went green over it**; tests import lazily, so the cycle never resolved in the order that breaks. Only the eager build caught it.

`strictObject` now defers its error map to first use, which costs nothing and makes the helper cycle-proof for every schema after this one rather than making each conversion prove it is not in a loop. The property is pinned via an observable — an alias-table getter that fires exactly when the map is built — and verified to go red when the map is hoisted back to construction.

`field` also gains its ADR-0010 protection envelope. It was the one type the original envelope probe actually checked (the other 24 took an early return), so it was the only gap anyone could see for as long as that probe was green — and it outlasted every gap the probe was hiding. **The undeclared-envelope debt list is down to one** (`action`), from eight.

`SelectOptionSchema`, `CurrencyConfigSchema` and the nested shapes under `FieldSchema` (lookup columns, lookup filters, `dependsOn` entries, roll-up summaries) close alongside it. Left open deliberately: `AddressSchema`, `LocationCoordinatesSchema` and `CurrencyValueSchema` are runtime *value* shapes with no consumers at all, two already marked for removal — not authoring surfaces, so strictness is not the question they raise.

Registered types closed at the top level: **22 of 25**. Still open: `action`, `dashboard`, `view`.

Authoring impact: a key `FieldSchema` does not declare is now rejected instead of silently discarded — it was already being ignored, so no working field changes.
