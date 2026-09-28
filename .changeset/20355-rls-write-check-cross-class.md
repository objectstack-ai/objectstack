---
'@objectstack/plugin-security': minor
'@objectstack/formula': minor
'@objectstack/driver-sql': patch
'@objectstack/lint': patch
---

fix(security)!: the RLS write check refuses a field-to-field comparison the read refuses — one comparison class, one answer per policy (#20355)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no key, value or stored shape changes; the write check now refuses at request time what the read already refused, and no shipped policy compares fields of two classes -->

**BREAKING** — an accept-set narrowing on the row-level write check, shipped as `minor`
under the launch-window convention (`check-changeset-no-major` refuses `major` until GA;
breaking-ness is carried by this banner and the ADR-0087 disposition above, not by the
level).

**What changed.** A row-level policy that compares two fields of no shared comparison
class — `record.status != record.amount` (text and a number), `record.status !=
record.photo` (text and a file field), `record.status != record.is_open` (text and a
formula field), `record.status != record.meta` (text and a json field) — already had
every read it scopes refused with `INVALID_FILTER` / 400 on the SQL drivers, because
driver-sql compiles a column-to-column comparison only within one class. The write
check did not know the rule: it compared the two raw values in-process, so an insert
or update the policy's `check` judges (or its `using`, standing in as the check) was
admitted and stored whenever that comparison happened to hold. Measured through
plugin-security and ObjectQL on SQLite, sqlite-wasm and PostgreSQL. The write check
now refuses the comparison too, with the read's envelope, `INVALID_FILTER` / 400, for
every insert (single or array), by-id update and predicate update it judges, and
nothing is stored. The same-class comparisons it always compared are compared as
before. The 400 names no column of the policy; the server log names the policy and
both columns. A comparison against a json or `multiple` field is refused by its
declared type now, where it used to be judged by the value each record held.

**`@objectstack/formula`.** `matchesFilterCondition(record, filter, options?)` takes an
optional third argument: `options.fields`, the object's declared columns (`type` and
`multiple` per field name). Given it, every `{ $field }` comparison between two
declared columns is judged by `crossFieldComparisonVerdict` from
`@objectstack/spec/data` before any record is read, and one the platform defines no
answer for throws `INVALID_FILTER` / 400. Without it the evaluator behaves exactly as
before. Two new exports go with it: `findCrossFieldClassRefusal(filter, fields)`, the
pure judgement, and `crossFieldClassRefusalCarriedBy(error)`, which reads the refused
comparison off the error for a server-side log.

**`@objectstack/driver-sql`.** `crossFieldComparisonClass` reads the same export
(`crossFieldColumnVerdict`) instead of keeping its own copy of the classification, and
layers above it only its internal type aliases. Every read answers as before.

**`@objectstack/lint`.** The `rls-predicate-unenforceable` finding for such a
comparison now states the write answer the runtime gives: the in-process write check
refuses it by the same classification and stores nothing.

**If a policy of yours is refused.** The platform defines no comparison between those
two columns on any path, so the policy never protected a read either. Compare a field
only with a field of the same class — a number with a number, text with text, a
boolean with a boolean, a date with a date, a datetime with a datetime, a time of day
with a time of day — or, if the two columns do hold comparable values, correct the
declaration of the one declared with the wrong type. `os validate` names every such
comparison.
