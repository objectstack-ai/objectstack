---
"@objectstack/spec": patch
---

The one `timeDimensions[].dateRange` refusal sentence names an EMPTY bound for what it is, instead of handing its author back the shape they just wrote (#18278).

`AnalyticsDateRangeSchema`'s array arm is `z.tuple([z.string(), z.string()])` — it judges arity and bound TYPE, never a bound's VALUE — so `['', '']` is **accepted** at every schema door and refused past it, by each face's own empty-bound check (`service-analytics`' `date-range-array-arm.ts`, `driver-memory`'s `memory-analytics.ts`). That is the residue `analyticsDateRangeUnrecognizedError`'s header in `@objectstack/core` already named. Measured at `ObjectQLStrategy.dateRangeBounds` before this change, its author read:

```
… ; received a two-element array. Refused past the schema door, by the analytics reader
that received it (ANALYTICS_DATE_RANGE_UNRECOGNIZED / 400).
```

— the arity they had written, with the value never echoed on this path and nothing said about what was wrong with it. After:

```
… ; received a two-element array whose bounds are both empty strings. …
```

- **Named at the bound that is empty** — `['', b]` and `[a, '']` say `whose start bound is an empty string` / `whose end bound is an empty string`, because the sentence never echoes the value, so *which* bound is a clause only this builder can supply.
- **A bound that is not a string keeps its TYPE description.** `['', 3]` reads `an array with a non-string bound`: the fault the arm itself refuses is named first, and the arities (`[]`, `['a']`, `[a, b, c]`) are untouched.
- **`a two-element array` survives as the LIT control** — the description for a two-bound window with nothing this clause can name, refused for something it cannot see (an unparseable bound VALUE carries its own `DATASET_INVALID` envelope). The empty-bound clause is not claimed when it is not true.
- ⛔ **Not an accept-set change.** The tuple arm still accepts `['', '']`; only the sentence the faces raise past it changed. The comment that asserted *"the only way such an array reaches a refusal is a bound that is not a string"* — false the whole time this residue was reaching it — is corrected in the same edit, since a false explanation is what kept the case unexamined.
