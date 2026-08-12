---
"@objectstack/spec": patch
---

docs(spec): close the stale `$contains` fold pointers in the `filter.zod.ts` per-backend history table and the `filter-text-conformance.ts` `@see` line

#7723 took the `i` flag off `driver-memory`'s `filterSubstringPattern`, closing
the #6682 tracking issue. Two docblock spots in `packages/spec` still pointed
forward at that landing as if it hadn't happened yet:

- `filter.zod.ts`'s per-backend history table (explicitly headed "measured …
  BEFORE the ruling" — kept as history per #7625) had a `driver-memory` cell
  reading "the last one standing, until #6682". The cell is historically
  accurate (it WAS the last case-folding face when written) but the "until
  #6682" tail described a future event that has since landed; it now reads
  "the last one standing; #6682 closed it (see 'Implementation status'
  below)". The table's other rows, including `driver-mongodb`'s, are left
  untouched — they are correct as pre-ruling history and #7625 already judged
  them that way.
- `filter-text-conformance.ts`'s `@see #6682` line read "mongodb landed,
  memory open", contradicting the same file's own header 37 lines earlier
  (updated correctly by #7723), which already says the memory half landed
  too. It now reads "mongodb and memory both landed".

No behavior, schema, or generated baseline changes — these are TSDoc comments
attached to exported schemas, which do reach `@objectstack/spec`'s published
`dist/*.d.ts` (verified: `grep` on the rebuilt dist shows the edited sentence
in `dist/filter.zod-*.d.ts`), so this ships as a patch changeset rather than
`skip-changeset`.
