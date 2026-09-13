---
"@objectstack/spec": patch
---

fix(spec): `FieldSchema` no longer prescribes `required` for `notNull` / `not_null` — the flattened column-constraint spellings now name `storage: { notNull: true }` (#16867)

Writing `notNull: true` (or `not_null: true`) on a field was refused — correctly — and then told to write `required` instead, via a rename row in `FieldSchema`'s alias table. `required` is the one key ADR-0113 exists to say is **not** the column constraint. `required`'s own description in the same file states the opposite of what the rename prescribed: *"NOT a column constraint — the physical NOT NULL is a separate explicit opt-in (`storage.notNull`)"*.

The failure mode was not the refusal — that fired, loudly, and did its job. It was the **remedy**: an author reaching for a NOT NULL column complied, wrote `required: true`, and received a nullable column plus a write-time gate, with nothing downstream to refuse it. The refusal read as though it had been satisfied.

All three flattened spellings — `notNull`, `not_null`, and `storageNotNull`, which already carried the correct sentence — now get one prescription naming the real key:

> physical column constraints live under `storage` — write `storage: { notNull: true }` (ADR-0113). There is no flat spelling of it: post-17 a column is NOT NULL because its author wrote that nested key, and for no other reason. It is NOT `required`, which is the WRITE contract (an insert must provide a value; an update may not null it out) and deliberately does NOT imply the column constraint — `required: true` alone leaves the column nullable. Write whichever of the two you meant, or both.

Both halves are named on purpose: the defect being repaired is that the author cannot tell which of the two axes they are getting, so a prescription naming only the column half would have fixed the measured direction and opened the mirror-image one.

**No accepted key moves.** `notNull` and `not_null` were refused before this change and are refused after it — a `guidance` / `guidanceSets` table decorates a rejection and never admits a key. Only the sentence attached to the refusal changed. `storage: { notNull: true }` parsed before and parses now; `isRequired` and `mandatory` are genuine spellings of the write contract, ADR-0113 moved neither, and both still rename onto `required`.

One mechanical note for anyone repairing a table like this: the entry moved from `aliases` to `guidanceSets`, not to exact `guidance`. `aliases` is indexed by `aliasProbe` (case- and separator-folded, so one row covered `not_null` too) while exact `guidance` is matched case-sensitively on the authored spelling — a lone `guidance.notNull` row would have quietly dropped `not_null` onto the edit-distance fallback. The two spellings are pinned separately for exactly that reason.
