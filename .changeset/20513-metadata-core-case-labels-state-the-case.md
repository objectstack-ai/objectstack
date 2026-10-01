---
'@objectstack/metadata-core': patch
---

The shared engine case tables and the published contract suites in metadata-core no longer cite tracker numbers in their case labels; each label states its case in words

Clause-②: no

Several labels these tables and suites ship ended with an issue-tracker number where the case belonged. A
test driven from them printed that number as part of its name, and a failing assertion quoted it as the
reason. The number goes; where the label did not already say what the case is, it now does.

- `ENGINE_DELETE_DISPATCH_CASES`, `ENGINE_UPDATE_DISPATCH_CASES` and `ENGINE_FINDONE_PREDICATE_CASES`:
  the `what` labels of 22 rows. Among them, the compare-and-set rows now say the by-id path would drop the
  CAS guard; the payload-id rows say which declared `where.id` would be silently dropped; and the falsy
  `where.id` boundary says it is a scalar, so neither the different-row refusal nor the non-scalar refusal
  applies.
- `@objectstack/metadata-core/testing`: the repository contract suite's `serialized-form identity` group
  title, and two `why` texts of `OBJECT_SCHEMA_MASK_CASES` (the empty-readable-set refusal, and the
  write-capable exemption, which now names the schema write gate, `manage_metadata`).

Text only: no case is added, removed or re-ordered, and no `options`, `data`, `expect`, `expectId`, `id`,
`readable` or `context` value moves. A suite that selects or skips these cases by their label text (a
`-t` filter, a skip list) needs the new spelling.
