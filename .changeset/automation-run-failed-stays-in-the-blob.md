---
"@objectstack/service-automation": patch
---

docs(automation): `sys_automation_run` says why `failed` has no column of its own, and `summary_json` names it (#15606)

`FlowRunSummary` carries five run-level totals. Four of them —
`selected_count`, `acted_count`, `skipped_count`, `unmeasured_count` — have a
column on `sys_automation_run`; `failed` rides inside the `summary_json` blob.
That asymmetry was filed as a finding and ruled on (decision batch #76,
2026-09-07) rather than closed by adding a fifth column, and this change is the
ruling: the reasoning now ships in the schema instead of living only on the
card.

The four are columns because ONE filter expression needs them in ONE row —
`selected_count > 0 AND acted_count = 0`, qualified by `unmeasured_count` — and
a `WHERE` clause cannot reach into a JSON blob for an operand, so every operand
of that expression has to be a column or the expression cannot be written at
all. `failed` is not one of its operands: it would be its own predicate
(`failed_count > 0`), nobody alerts on it today, and a caller that wants it has
already fetched `summary_json`.

What a consumer sees change:

- `summary_json`'s `description` now names `failed` as the field to read
  lost-row counts from, states that the run-level totals live in the blob
  alongside the per-node breakdown, and repeats the `unmeasured`/`failed`
  convention that an absent count means "not tracked", never zero. This string
  ships in the published bundle and is what a Studio/admin surface renders for
  the field, which is why this carries a changeset rather than
  `skip-changeset`.
- The comment above `selected_count` — the paragraph that explains why the
  four are columns, and therefore the paragraph a reader is in when they
  notice the fifth is not — now carries the verdict for `failed` and the one
  condition that re-opens it: the first real need to ALERT on "which runs lost
  rows this week" is the card that adds `failed_count`, mirroring
  `unmeasured_count` (null on rows written before the column existed, never
  `0`) — one column on an ADR-0103 engine-owned object, a human-floor change.
- `ObjectStoreSuspendedRunStore`'s terminal-row write, where a fifth
  `record.summary?.failed ?? null` line would go, points at that verdict so the
  question is not re-derived from the write site either.

No schema shape moves: no field is added, removed or renamed, no type or
`required` flag changes, and the accepted set of every object and payload is
byte-for-byte what it was. `sys-automation-run-failed-count-verdict.test.ts`
pins both halves — that there is still no `failed_count` (or any other
`fail`-named) column, and that `summary_json`'s description still names
`failed` — so the explanation cannot rot into a claim the schema no longer
supports.
