---
'@objectstack/core': minor
'@objectstack/driver-memory': patch
---

`dateRange`'s array arm has ONE arity everywhere: a two-element window, or the ADR-0112 refusal (#17596)

The shared conformance kit
(`analyticsDateRangeConformanceFindings`) had exactly one array case — a
two-element window — so the ARITY of the array arm was governed nowhere and
every analytics face was free to invent a meaning for `dateRange:
['2026-01-01']`. Four faces in one package had invented three (#17124), and a
fifth — `driver-memory`'s cube face — had invented a fourth.

**The kit** now exports `ANALYTICS_DATE_RANGE_NOT_A_WINDOW` and holds every
registered face to the rule the `service-analytics` faces already carry: an
array that is not two non-empty string bounds is refused with
`ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400. No new rule was invented for it, and
the existing two-element window case is untouched — it is this case's control,
so "refuse every array" cannot pass.

**`driver-memory`** now answers that refusal instead of dropping the window.
MEASURED end to end over four rows spanning 2020…2099: `['2026-01-01']`, `[]`
and `['2026-01-01', '2026-01-31', '2026-02-01']` each emitted a pipeline
byte-identical to one with **no `dateRange` at all** — every row selected, the
"plot all of history" failure #3650 was filed about — and `[null, null]`
compared instants against the string `'null'` and selected none.

**Levels.** `@objectstack/core` is `minor`: it gains a new exported symbol on
its index (`ANALYTICS_DATE_RANGE_NOT_A_WINDOW`), and a purely additive widening
of a published package's public surface takes at least `minor` whatever the
commit type says. `@objectstack/driver-memory` is `patch`: its public surface is
byte-unchanged — no new export, no new accepted key or value. Its behaviour does
change, from selecting every row to refusing with `400
ANALYTICS_DATE_RANGE_UNRECOGNIZED`, and that is a `patch` because the old
behaviour was a defect and never a contract: the spec's own refusal wording
already said an explicit window is the two-element array, and the #16322
migration table already told authors to write a single day as two bounds. A
release that stops answering a shape the contract never admitted is a fix, not a
feature — and the shapes it now refuses had no correct answer to lose.

**If you wrote a one-element array**, write both bounds: `['2026-01-01']`
becomes `['2026-01-01', '2026-01-01']`, which selects exactly that day on every
face and did so before this change too. The refusal names the shape that
arrived, the two-element contract and that spelling.
