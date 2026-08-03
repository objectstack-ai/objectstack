---
'@objectstack/spec': patch
---

Re-measure the #4001 unknown-key strictness ledger, and fix the instrument that was measuring it.

No schema changed posture in this change — it is the measurement step the
2026-08-03 ruling asked for before the remaining batches are cut.

**The site counter now reads the AST instead of matching source text**, because
the textual method was wrong in both directions at once. It counted
`z.object({ … })` written inside JSDoc prose (`ui/action.zod.ts` declared 9 sites
and has 8), and it missed both the prettier-wrapped `z\n  .object({` form
(`ui/chart.zod.ts`, 6 → 7) and `z.looseObject(` (`data/field-value.zod.ts`,
1 → 2). On `ui/` the two errors cancelled exactly, so a correct section total sat
over two wrong rows.

The worst case was `automation/time-relative-trigger.zod.ts`: its only site is
written wrapped, so it counted **zero** — and a zero-site file is deliberately
skipped by the coverage walk, so an authorable schema stayed outside the ledger
while the gate printed "no undeclared schema files". It is now classified.

**`check:strictness-ledger` gained a remaining-strip-site map** — per file, how
many object sites still silently discard unknown keys, which is the number batch
plans are actually scheduled against and which nothing measured before. It is
gated in both directions: a file with strip sites must have a row, and a row
whose file reaches zero strip sites fails, so a closed file drops out of the
worklist rather than outliving it.
