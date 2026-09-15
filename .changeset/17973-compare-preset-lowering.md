---
"@objectstack/service-analytics": patch
---

fix(analytics): a `dateRange` preset plus `compareTo` is lowered and shifted instead of refused as an "invalid date" (#17973)

`DatasetExecutor.runCompare` read the STRING arm of `dateRange` as
`[range, range]` — the degenerate fallback #17015 removed from every other
analytics face. `parseUTC` was handed the preset NAME, so a declared, honoured
member of the closed vocabulary was refused outright. Measured end to end
through the executor, a valid preset plus `compareTo`:

```
DATASET_INVALID  400  [dataset-executor] invalid date in dateRange: "last_30_days"
```

The diagnostic is not merely unhelpful, it is FALSE. `last_30_days` is exactly
what the schema, the dashboard date filter and the docs tell an author to
write, so "invalid date" sends them to check a date that is already correct —
a repair that does not exist. This face was not in #17015's kit, so nothing
measured it and nothing noticed.

Both arms now go through one face lowering, which calls the shared
`resolveAnalyticsDateRangeString` for the string arm — the same call the
ObjectQL strategy, the native-SQL strategy, the draft-preview evaluator and
driver-memory's cube face make — and the resolved window is then projected onto
the comparison math's UTC calendar, with `endExclusive` honoured so the ten
calendar presets are not a day too long. `this_month` plus
`compareTo: { kind: 'previousYear' }` now compares September against the
previous September, rather than refusing.

Two consequences worth knowing when you upgrade:

- **A string outside the vocabulary now answers the shared envelope.** On this
  path it used to be `DATASET_INVALID`; it is now
  `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400, the ADR-0112 envelope the other
  faces already raise, with the message that lists the thirteen declared preset
  names. One condition, one envelope. Code keying on `DATASET_INVALID` for an
  unrecognised `dateRange` STRING should key on
  `ANALYTICS_DATE_RANGE_UNRECOGNIZED` instead.
- **The caller's explicit `[start, end]` window is untouched**, bound for bound,
  with the inclusive upper reading it has always had — including the
  `DATASET_INVALID "invalid date in dateRange"` refusal for a bound that is not
  a date, which is unchanged.

`runCompare` is also registered as a face in the shared `dateRange` conformance
kit, so the next face that forgets to lower a preset is caught by a test rather
than by a customer.
