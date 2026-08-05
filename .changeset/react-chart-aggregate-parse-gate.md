---
"@objectstack/lint": minor
---

feat(lint): the react-page publish gate PARSES `ChartAggregateSchema` instead of re-deriving it (#5020)

`<ObjectChart aggregate={{…}}>` is judged at publish time by
`validate-react-page-props`. That gate used to RE-DERIVE the aggregate's
declaration: a local `CHART_FUNCTIONS` copy of the function vocabulary and a
hand-written twin of the schema's count/field refinement. Two implementations of
one contract, each free to drift — and, because unknown-key handling is a
property of a **parse** rather than of a list of `if`s, a gate with no
unknown-key check at all. The rule now calls `ChartAggregateSchema.safeParse()`
on a statically resolvable literal, exactly as #5022 did for
`ChartDrillDownSchema` beside it, and both hand-derived copies are deleted:
`@objectstack/spec` is the single source of the vocabulary and the refinement
again.

**Newly reported (all `error`, all previously silent).** These are shapes the
schema, the published react-blocks type and objectui's renderer already agreed
were wrong; the old gate simply could not see them:

| authored | before | after |
|---|---|---|
| `aggregate={{ field: 'total', groupBy: 'status' }}` (no `function`) | accepted | `aggregate.function: Invalid option: expected one of "count"\|"sum"\|"avg"\|"min"\|"max" (nothing is set there)` |
| `aggregate={{ field: 42, function: 'sum', groupBy: 'status' }}` | accepted | `aggregate.field: Invalid input: expected string, received number` |
| `aggregate={{ function: 'count', groupBy: 42 }}` | accepted | `aggregate.groupBy: Invalid input (received 42) — no accepted form matched: (1) … (2) …` |
| `aggregate="count"` / `aggregate={[]}` | accepted | `aggregate must be a configuration object, not string.` |

**Re-worded, same verdict.** Two messages now arrive from the schema rather than
from this rule's own copy. If you match on lint output, update the text:

- FROM `aggregate.function "median" is not an aggregation this chart can run.`
  (hint: `Use one of: count, sum, avg, min, max.`)
  TO `aggregate.function: Invalid option: expected one of "count"|"sum"|"avg"|"min"|"max" (received "median")`
  — the vocabulary is the enum's own, and the author's value is echoed back from
  the input (the one part zod does not put in the message).
- FROM `aggregate.function "sum" has no "field" to aggregate.`
  TO `aggregate.field: aggregate.function "sum" needs a "field" to aggregate (only "count" may omit it).`
  — verbatim from the schema's refinement.

The rule id (`react-chart-aggregate-invalid`) and the severity are unchanged for
both.

**`aggregate.groupBy` missing is a NEW `warning`, deliberately not an error.**
It is the one violation the platform does not agree with itself about:
`ChartAggregateSchema` and the published react-blocks type both declare `groupBy`
**required**, while objectui's `ObjectChart` honours its absence
(`schema.aggregate?.groupBy || schema.xAxisKey`) and this protocol's own
`chartAggregateCategoryKey` documents the ungrouped single-row result. Gating it
would break a working authoring shape to enforce a declaration the platform does
not keep, so the finding explains the situation and does not fail
`os lint`/`validate`/`compile`. Whether the schema loosens or the renderer
tightens is decided on #5583.

**What this does NOT fix yet.** `ChartAggregateSchema` and `ChartGroupBySchema`'s
object arm are still STRIP-posture, so the parse this gate now runs **drops** an
unknown key rather than reporting it: `groupby` for `groupBy` and
`dateGranularty` for `dateGranularity` still degrade a chart to one ungrouped
point with the build green. Wiring the parse is the precondition for closing
that, not the closing — `.strict()` is a property of a parse, and until now there
was no parse to make strict. The spec-side tightening is **#5583**; the tolerance
is pinned by name in this rule's tests so a wired gate cannot be mistaken for a
closed one (#4583).
