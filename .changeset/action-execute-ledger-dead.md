---
'@objectstack/spec': patch
---

liveness ledger: re-classify `action.execute` `live` → `dead` (#13036)

The entry claimed a `.transform` that lowers `execute` → `target` and drops the
alias. No such transform exists: `packages/spec/src/ui/action.zod.ts` has exactly
two `.transform` calls and both are `lowerRequiresFeature`. The alias and its
lowering were removed together in protocol 17 (#3855, landed 2026-07-28); the key
has been a `retiredKey` tombstone ever since, and `packages/cli/src/utils/lower-callables.ts`
declines to bind a function-valued `execute` on purpose so the tombstone fires.

Data-only: no schema, no runtime, no authoring surface changes — authoring
`execute` already failed `tsc` and the parse before this, and still does. The row
STAYS, per the `rls.priority` precedent a `retiredKey()` tombstone keeps the key
in the walked shape, so deleting the row would report UNCLASSIFIED. `liveness/` is
in this package's `files` array, so these ledgers ship in the npm tarball and this
is published data.
