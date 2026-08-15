---
"@objectstack/core": patch
"@objectstack/objectql": patch
"@objectstack/service-analytics": patch
---

fix(objectql): a temporal filter comparand the platform cannot interpret is refused at the engine door instead of answering 200 with zero rows (#8690)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
renamed, retired or tombstoned — no spec schema is touched at all. The change
is a new runtime refusal at the engine's filter collection point, plus the
routing decline that stops the raw-SQL analytics path bypassing it. -->

A `datetime` / `date` / `time` field filtered with a bare string the platform
cannot read — `last_30_days`, `not-a-date-at-all` — was bound **as written**
all the way to the driver, where the comparison is false for every row. The
caller received `HTTP 200`, an empty result set, and nothing to indicate the
filter was meaningless. An unknown `{placeholder}` in the same position was
already refused loudly (`FILTER_TOKEN_UNKNOWN` / 400, listing the resolvable
tokens), so one API answered two shapes of unusable comparand two different
ways.

It is concretely reachable rather than theoretical: `last_7_days` /
`last_30_days` / `last_90_days` are **declared preset names** in the dashboard
schema. The shipped console lowers them to `{N_days_ago}` macros before they
reach the API, so the console path was always safe — but a saved report, an
integration, an MCP client or an AI-authored query sends the preset name itself
and got a silent zero. An empty chart is the hardest failure to debug: it is
indistinguishable from "there is genuinely no data".

Such a comparand is now refused at the ObjectQL engine's single filter
collection point, with `code: 'INVALID_FILTER'` and `status: 400`, naming the
field, the value, the key path and the spellings that would work. That seam is
the one place holding the caller's comparand and the field's **declared type**
at the same moment, and every verb (`find` / `findOne` / `count` / `aggregate`
/ `update` / `delete`) and both filter spellings (the array sugar and the
lowered condition) pass through it, so all four backends inherit one answer
rather than four. `NativeSQLStrategy` additionally **declines** such a query so
the raw-SQL analytics path falls through to that door instead of binding the
value into its own statement.

Deliberately unchanged, each by ruling: a `{placeholder}` keeps its existing
refusal one layer down (the door runs before token resolution and steps around
them, so `{30_days_ago}` still resolves normally); non-string comparands are
untouched (a number is epoch milliseconds, a `Date` is an instant); and the
**empty string** keeps today's behaviour exactly — it binds as `''` and matches
every non-null row, which is a separate question that remains its own card.
