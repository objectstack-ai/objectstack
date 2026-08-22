---
"@objectstack/driver-memory": patch
---

**Bug fix (one query, two answers):** `avg` and `sum` over a **boolean** column now answer the same numbers on `driver-memory` that every SQL face and objectql's in-memory fallback already answered, instead of `null` and `0` (#11065).

Measured on one `AnalyticsService.queryDataset` call, one dataset, one set of rows, run twice — five `crm_case` records, four closed (three with `is_sla_violated: false`, one `true`), one open with `true`:

```
[memory] unfiltered      {"avg_sla_violated":null,  "closed_count":4}
[memory] closed-filter   {"avg_sla_violated":null,  "closed_count":4}
[sqlite] unfiltered      {"avg_sla_violated":0.4,   "closed_count":4}
[sqlite] closed-filter   {"avg_sla_violated":0.25,  "closed_count":4}
```

SQLite's are the arithmetically correct numbers (2/5 unfiltered, 1/4 over the closed cases). The `count` measures beside them agreed on both drivers, and so did a `derived` ratio built on those counts — the divergence was specific to averaging a boolean.

**There were three implementations of "average a column" in play, and this driver was the lone outlier.** SQLite lowers `AVG(col)`; objectql's in-memory fallback (`in-memory-aggregation.ts`) coerces with `Number(v)`, and `Number(true) === 1`; `driver-memory` selected its aggregands with `typeof v === 'number'`, which drops every boolean, leaving `nums.length === 0` and returning `null`. So this is an alignment to the two faces that already agreed, not a new convention.

**Both of this package's faces carried the defect independently**, and both are fixed:

- the **data face** (`computeAggregate`, reached by `engine.aggregate` pushdown — the door the report's own repro takes) selected with `typeof v === 'number'`;
- the **analytics face** (`buildAggregator`) emitted a bare mingo `$avg`, and mingo ignores a non-numeric value exactly as MongoDB does — measured at `{avg: null, sum: 0}` over the same five rows.

Fixing one alone would have left the other free to keep its own answer, which is the shape of this package's recurring defect (#5374, #6814).

**`sum` is aligned with `avg` deliberately.** The two share the data face's arm, and `SUM(bool)` is "how many true" on every SQL face and in the objectql fallback; correcting only the function the report named would have left the identical defect alive one function over, answering `0` for a column with two `true` rows.

**The coercion is boolean-only, and the narrowness is the point.** `null`, a missing key and a non-numeric string reach the accumulators unchanged and stay excluded. Adopting the wider half of objectql's `toNumber` — which maps a non-numeric string to `0` — would average garbage as zero rather than excluding it; whether that is right is a separate question this change does not open, and a regression row pins the exclusion on both faces so it cannot arrive by accident.

**Why it mattered beyond the number.** Neither face errors, so a dashboard tile bound to a rate measure rendered a percentage under SQL and a blank here, indistinguishable from "no matching rows". The test-facing half is worse: a suite pinning such a measure on the in-memory driver asserted against `null` and could not fail in the direction that matters. Nothing in the repo pinned the old value — the shared cross-driver fixture (`AGGREGATION_ROWS`) carries no boolean column at all, which is why every face could disagree here unobserved.
