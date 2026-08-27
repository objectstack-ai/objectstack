---
"@objectstack/driver-memory": minor
"@objectstack/driver-mongodb": minor
---

fix(drivers): a declared field written as an explicit `undefined` is indistinguishable from one never written (#9276)

A row has exactly two states to say about a field, each with a defined meaning:
**the key is absent** ("no value was ever written") or **the key holds a
value**. An own key holding `undefined` is neither. Only a JS-backed driver can
emit it — a SQL NULL arrives as `null`, which is a value — and every consumer
downstream had to invent a reading of it. Measured on `origin/main`, they did
not agree: `has(record.f)` on the real `@objectstack/formula` CEL engine reads
it as ABSENT, `materializeDeclaredFields` reads it as ABSENT by documented
design, and a bare `f in row` reads it as PRESENT.

Both JS-backed drivers were measured separately, and they did **not** match:

- **`driver-memory`** preserved the own key holding `undefined` through
  `create` and handed it back from `find`. Its own projection path and its own
  matcher already read the shape as absent (`projectFields` skips `undefined`
  values, `{f: {$exists: true}}` excluded it, `{f: {$null: true}}` included it)
  — so the returned row was the only surface in the driver still claiming the
  key was present, and the same stored row answered `'f' in row` differently
  depending on whether a projection was requested.
- **`driver-mongodb`** SPLIT. `create()` returns the object it built in
  process, so the field came back as an own key holding `undefined`; but the
  MongoClient default is `ignoreUndefined: false` and this driver sets no
  override, so BSON stored `null` for that same field and a subsequent `find()`
  answered `null` — a value. One write, two answers, from one driver.

Both drivers now drop own keys holding `undefined` on the way into storage, so
a declared field written as `undefined` and one never written are the same row:
deep-equal, same own keys, same answer to every presence test. `null` is
untouched and stays a value.

Fixed at the producer rather than at each consumer: converging one consumer
resolves one seam, but the next consumer that reasons about key presence
re-acquires the problem.

**Behaviour that changes, precisely.** What these two packages RETURN for one
input class, and what `driver-mongodb` STORES for it. A caller passing an
explicitly-`undefined` property to `create`/`bulkCreate`/`update`/`updateMany`
(or seeding `initialData`) no longer sees that key in the returned row, and no
`null` is written for it in MongoDB. `undefined` does not survive JSON, so this
shape cannot arrive over the wire — reaching it requires in-process code.

**What does NOT change.** No accept set moves: no schema, refine, validator or
public type is touched, nothing that parsed before is refused now, and no
exported name is added, removed or moved. Filter results are unchanged in both
drivers — measured identical before and after for `$null` / `$exists` /
equality on `driver-memory`, and on `driver-mongodb` `$null: true` lowers to
`$eq: null` and `$null: false` to `$ne: null`, which MongoDB matches
identically against a missing field and a stored `null`.

Scope on `driver-mongodb` is the INSERT doors and the values returned.
`$set`-shaped patches are deliberately untouched: changing them would answer
"what does a patch carrying `undefined` mean — clear the field, or leave the
prior value standing" which is a storage-contract question, not this repair's
to settle. On `driver-memory` the normalisation is applied POST-merge for the
same reason — it keeps today's answer (every measured consumer read the merged
own-key-`undefined` as "absent", and the row now says absent outright) rather
than silently turning such a patch into a no-op.
