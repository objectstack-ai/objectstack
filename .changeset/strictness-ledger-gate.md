---
"@objectstack/spec": patch
---

Add a gate that holds the #4001 strictness ledger to the code it describes.

`docs/audits/2026-07-unknown-key-strictness-ledger.md` is the campaign's map:
which `z.object` sites are authorable (the `.strict()` ratchet target), which are
wire, which are deliberately open. Every step reads it to pick the next move, and
nothing kept it honest. It went stale twice in one week — a classification that
verification disproved (`hook.zod.ts`, #4207) and a "next step" that had shipped
months earlier (the warning layer, #4218). A map that drifts is worse than no
map, because it gets followed.

`check:strictness-ledger` enforces the claims in it that are mechanically
checkable:

- **Site counts** — the ledger states its own method (`z.object(` occurrences per
  file), so every number is verifiable. A stale count means schemas were added or
  removed under a `Class` verdict nobody re-examined.
- **Coverage** — every `*.zod.ts` with sites in a triaged directory must have a
  row. Zero-site files (pure enum/token modules) are skipped, and become
  reportable the day they grow their first `z.object(`.
- **Section totals**, and that a row claiming "strict as of" names a file that
  really contains `.strict()`.

The `Class` column is deliberately not checked — authorable vs wire vs open is a
human judgement, and the campaign's rule is verify-before-tightening. The gate
protects the arithmetic and coverage so that judgement is made against current
code.

First run found 11 drifts, including six moved counts (`ui/app.zod.ts` had gone
11 → 18), two unbalanced section totals, and one genuinely unclassified file
(`automation/io-node-config.zod.ts`). All corrected here.
