---
"@objectstack/spec": patch
---

Correct two stale author-facing contract statements in `Object.enable` / `Object.lifecycle` — text only, no change to what parses.

- `lifecycle.ttl.onlyWhen` × `archive` (#10526): the refusal's rejection message no longer says "the Archiver moves rows by age alone". Since #10347 the Archiver selects candidates by the declared ttl cutoff, so that reason had gone stale; the reason it states now is the one that holds — the ttl **window** carries over to the Archiver, the `onlyWhen` **filter** does not, so the filtered-out rows would still be archived. The refusal itself is unchanged.
- `enable.files` / `enable.feeds` (#10336): the two `.describe()` strings said the flags reject *creation*. Since #10170 both capability gates are registered on `beforeUpdate` as well, so they refuse any write that makes a row **target** the walled object — a create and an update that re-points/re-threads an existing row alike (403 `FILES_DISABLED` / `FEEDS_DISABLED`). The strings now state that, matching the docblocks above them. `enable.activities` is unaffected and untouched.
