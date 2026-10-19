---
"@objectstack/client": minor
---

feat(client): `packages.publishDrafts(id, { backfill })` sends the opt-in backfill of new fields' defaults

Clause-②: yes (widening)

- `opts.backfill?: Array<{ object, field }>` is sent in the publish body; the response's `backfillApplied` reports the rows written per field. A field the publish does not add, or one without a literal `defaultValue`, refuses the whole request with a `400` before anything is published.
