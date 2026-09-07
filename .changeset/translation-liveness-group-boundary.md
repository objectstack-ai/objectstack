---
'@objectstack/spec': patch
---

liveness ledger: `translation`'s `_note` states the live/planned boundary instead of a hand-maintained total

The header claimed "11 of 12 groups live; the twelfth, `datasets`, …". No reading of the
file's own `props` produces that pair. Measured on this commit, `props` holds fourteen
entries — the eleven translation groups `translationDataShape()` declares, plus `locale`
and the item-identity keys `name` / `label` — of which exactly one row, `flows`, is not
`live`, and `datasets` is one of the groups rather than a twelfth. Counting all of `props`
gives thirteen live of fourteen; counting groups only gives ten of eleven. Neither is
eleven of twelve.

This is the second wrong total the same sentence has carried. It previously read "10 of 11
groups live; the one dead group (`validationMessages`) …", describing a group removed in
17.0.0 (#4667) — prose outliving its subject in the header of the very file whose rows warn
about that. So the integers are deleted rather than re-derived, on the #7377 precedent that
moved this ledger family's other hand-maintained counts out of prose and into a generated
artifact: the sentence now names the BOUNDARY ("every group but `flows` is live"), which the
per-prop rows below it carry and `state-counts.md` totals, and it records why a total taken
over `props` is not a total of groups. Both former totals are kept, quoted, as the
sentence's own correction record.

Published data, prose only: `liveness/` is in this package's `files` array, so these ledgers
ship in the npm tarball. No `status` value moves, no schema changes and no gate verdict
changes — every non-`live` row in the file, at every nesting level, is `flows` or one of its
children.
