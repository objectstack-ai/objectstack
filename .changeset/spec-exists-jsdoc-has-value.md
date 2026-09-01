---
'@objectstack/spec': patch
---

docs(spec): `$exists` JSDoc said key-presence, which has been false since protocol alignment (#13709)

`SpecialOperatorSchema.$exists` carried `Field exists check (primarily for NoSQL) -
MongoDB: $exists`. That describes key-presence, and key-presence stopped being what
`$exists` means when the has-value alignment landed (PR #13529 / `9dac1ae017`). The
line was not stale phrasing — it was false, and it is the last of the six sites that
carried the old claim; the other five were corrected by PR #13581 / PR #13577.

The corrected wording is the one recorded on #13539 and already shipped on those five
sites: `$exists` asks whether the field HAS A VALUE (`!= null`), the exact inverse of
`$null`, never key presence — lowered to `IS NOT NULL` / `IS NULL` on SQL and to
`{$ne: null}` / `{$eq: null}` on MongoDB. Verified against all three evaluators before
rewriting: `formula`'s `matchesFilterCondition` (`v === true ? actual != null : actual == null`),
`objectql`'s `having` face, and the `filter-logic-conformance.ts` table, which enrolls
`$exists` in both directions.

Prose only. No accept/reject change: `$exists` was and stays `z.boolean().optional()`,
and the JSDoc is a comment, not a `.describe()` — the schema, its JSON-Schema
projection and every generated artifact are byte-identical. It reaches consumers as
the hover text on `@objectstack/spec`'s shipped `.d.ts`, which is why this is a patch
rather than no changeset at all.
