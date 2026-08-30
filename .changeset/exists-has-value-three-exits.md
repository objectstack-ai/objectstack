---
"@objectstack/driver-memory": minor
"@objectstack/driver-mongodb": minor
---

fix(drivers): `$exists` means HAS A VALUE on the live mingo path, the analytics face and `translateFilter` (#13195)

The platform's settled semantic is that `$exists` means "the field has a value"
(`!= null`), never key-presence — #5298 leg ③ / #5369, landed in PR #5962. Three
exits still read key-presence; the maintainer ruled on 2026-08-30 that all three
align. They now do:

- `driver-memory`'s **live mingo query path** (`InMemoryDriver.find()`) — the
  operator went to mingo under its own name, and mingo tests key presence;
- `driver-memory`'s **analytics execution face** — it built its own
  `{$exists: <bool>}`, so it inherited key-presence independently;
- `driver-mongodb`'s **`translateFilter`** — it passed the operator through, and
  MongoDB's `$exists` is key-presence at the wire level.

Nothing was invented. All three lower to `{$ne: null}` / `{$eq: null}` — the
spelling the same files already emit for `$null` — which answers has-value on
**both** readings of "no value": a stored `null` and an absent key.

**Grading, argued from what was measured rather than from custom.** This is
`minor`, not `patch`, and the sibling card #13166 is why the distinction is
worth stating: that one graded `patch` on the explicit ground that
`InMemoryDriver.find()` was unaffected and only the non-exported reference
matcher moved. Here the opposite is true — the live query path callers actually
reach changes on **two published drivers**, on a filter operator in the public
Filter Protocol. Measured on a 3-row fixture where one row stores `name: null`:

| filter | before | after |
|:--|:--|:--|
| `{name: {$exists: true}}` | `['1','2','3']` | `['1','2']` |
| `{name: {$exists: false}}` | `[]` | `['3']` |
| `{$not: {name: {$exists: true}}}` | `[]` | `['3']` |

The middle row is the harm the ruling's record calls the hardest live one: a
caller asking for the rows with **no value** got an empty result — silent
absence, with nothing to narrow — on three of the four exits. A caller who was
getting nothing starts getting rows, which is a behaviour change however welcome
it is.

The **key-absent** reading is unchanged on every exit, by construction and by
test: `{$ne: null}` already answers has-value there, so the column that agreed
with the ruling before still agrees. It is kept in the suites as the control
that the alignment moved only what it was meant to.

**One thing the ruled lowering needed that the ruling did not name.** `{$ne:
null}` / `{$eq: null}` reuse keys an author can write on the same field, so
`{name: {$exists: true, $ne: 'b'}}` would assign `$ne` twice into one object and
one of the two constraints would vanish — with *which* one decided by the
author's key order. Measured unguarded: that filter answered `['1','3']` and its
key-swapped twin answered `['1','2']`, where the reference matcher says `['1']`
for both. Four composed cells that agreed with the reference matcher on `main`
would have started disagreeing. So a lowered `$exists` whose key is already
taken is promoted to its own `$and` branch instead of merged; a free key still
merges inline. Both key orders now emit one document, and every composed cell
measured agrees with the reference matcher — including two that did **not**
agree before this change.

⛔ Not included, deliberately: no `FILTER_LOGIC_CASES` enrolment and no
`packages/spec` edit (the backends had to move first — that is the card's own
step 4, and it is the next card), and nothing retires or discourages `$exists`
in favour of `$null`. Whether one predicate should keep two authorable spellings
is the consumer census, #13492.
