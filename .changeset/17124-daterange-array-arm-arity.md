---
"@objectstack/service-analytics": patch
---

fix(analytics): a `dateRange` array that is not a two-bound window is refused, once, instead of meaning three different things (#17124)

`AnalyticsDateRangeSchema`'s array arm is a bare `z.array(z.string())` with no
length constraint, so `dateRange: ['2026-01-01']` is schema-valid and reaches the
analytics faces through `POST /analytics/dataset/query`, which types its selection
from `AnalyticsQuery` and never Zod-parses it. The four faces in this package that
read the arm answered it three different ways — measured over one authored
document and four rows:

| face | `['2026-01-01']` meant |
|---|---|
| `ObjectQLStrategy.dateRangeBounds` | the point window `created_at >= '2026-01-01' AND <= '2026-01-01'` |
| `NativeSQLStrategy` | no time clause at all — the whole dataset |
| the draft-preview evaluator | an upper bound of the string `"undefined"`, which every ISO date sorts below — everything from that day onward |
| `DatasetExecutor`'s `compareTo` pass | the point window, shifted — compared against a primary pass that may have read all of history |

For a dashboard that is one day's number, the whole dataset's, and everything
from that day onward, from the same document, decided by which backend answered.
`[]` and `[a, b, c]` split the same three ways, and `[null, null]` reached
`parseUTC(null)` as a bare `TypeError` — a 500 for a malformed request.

One rule is now the single reading of the arm and all four faces call it; the
three divergent fallbacks are deleted. An array that is not exactly two string
bounds is refused with the ADR-0112 `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400
envelope — the answer the contract already gives for a `dateRange` that does not
denote a window. A two-element window is untouched on every face, bound for
bound, including the inclusive upper reading a caller's bounds keep (#16179) and
the half-open bare-day widening on the SQL side (#3777).

### Write both bounds

| wrote | write instead |
|---|---|
| `dateRange: ['2026-01-01']` | `dateRange: ['2026-01-01', '2026-01-01']` |

That spelling already selects exactly that one day on every face, and it is the
same instruction #16322 shipped for the single-day string dialect.

⭐ Shipped as `patch`, not as a breaking narrowing, because nothing DECLARED
moves. The spec's own refusal wording already states that *"an explicit window is
the two-element array [start, end] of ISO dates or {date-macro} tokens"*, and
#16322's shipped migration table already told authors to write a single day as
`['2026-01-20', '2026-01-20']`. A one-element array was therefore never a valid
document; it was an invalid one that four faces answered arbitrarily, and a
behaviour that was never one behaviour is not a behaviour this removes. The Zod
type admitting the shape is weaker than the contract the same file states —
tightening it is a separate, spec-owned question.
