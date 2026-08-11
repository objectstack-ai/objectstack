---
"@objectstack/driver-mongodb": patch
---

fix(driver-mongodb): the `$contains` family is case-SENSITIVE — the hardcoded `$options: 'i'` is gone (#6682)

**Row-set change for anyone filtering text on MongoDB.** `$contains`,
`$notContains`, `$startsWith` and `$endsWith` translated to a `$regex` with a
hardcoded `$options: 'i'` beside it, which is MongoDB's full-Unicode case fold.
That flag is off all four arms. `{ name: { $contains: 'acme' } }` no longer
returns `ACME Corp`.

This is #4706 **Q2 = A** — the family is case-sensitive on every backend —
arriving at the last driver that was on the wrong side of it. #6518 flipped the
SQL family (`GLOB` on the SQLite dialects, `LIKE` over a binary cast on MySQL,
`LIKE` unchanged on Postgres); `formula`, ObjectQL's `having` and
service-analytics' compilers were already case-exact.

**Both directions of the defect mattered.** The fold OVER-matched — it returned
rows the filter excludes, which on an RLS read scope is over-reach rather than a
loose filter (#3948) — and it folded the whole Unicode range, overshooting the
ASCII-only boundary Q1 = A holds `$icontains` to.

**If you were relying on the fold, write `$icontains`.** It is the deliberate
case-insensitive spelling, implemented on this driver since #6520, and it folds
ASCII only (`café` does not match `CAFÉ`) — the one domain every backend can
deliver.

Unchanged: `escapeRegex`, so the comparand is still matched LITERALLY (`a.b`
matches `a.b`, not `axb`), and `$icontains`, whose fold has always lived in the
pattern rather than in `$options`. Every face of this driver —
`find`/`count`/`update`/`delete` and the aggregation `$match` — routes through
the one `translateFilter`, so there is no second answer to align.

The driver's `FILTER_TEXT_CASES` conformance cell is now CLEARED: the new
server-free suite `mongodb-filter-text-conformance.test.ts` imports the shared
case-set and drives all seventeen cases, rejection rows included, and the DEBT
row for this cell is deleted from `scripts/check-driver-conformance.mjs`.
`driver-memory`'s half of #6682 stays open under the #5499 freeze, so that card
remains open.
