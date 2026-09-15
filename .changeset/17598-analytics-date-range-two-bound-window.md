---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/types": patch
"@objectstack/rest": patch
---

fix(spec)!: `timeDimensions[].dateRange`'s array arm is exactly two string bounds, and each refusal ORIGIN gets a true sentence (#17598; ruling A, decision batch #117 item 3)

<!-- adr-0087: registered analytics-date-range-array-two-bounds-required -->

**BREAKING** accept-set narrowing at `timeDimensions[].dateRange` — shipped as
`minor` under this repo's launch-window convention for breaking changes
(`scripts/check-changeset-no-major.mjs`), above the `patch` floor the `fix`
commit type sets, and the same grade the one comparable precedent took: the
STRING-arm closing on this same schema is #16041, and it shipped
`"@objectstack/spec": minor` (`packages/spec/CHANGELOG.md` 17.4.0, under Minor
Changes). ⚠️ Its driver half #16322 declares `"@objectstack/spec": patch`, but
that entry is — in that changeset's own words — "a `PROVENANCE_WAIVERS` row
only", not an accept-set narrowing, so it is not a grade this one is measured
against. The maintainer
ruling calls it a "major changeset"; under the launch window that phrase maps to
the protocol MAJOR the migration registers against (18), not to the changeset's
bump level, which `scripts/check-changeset-no-major.mjs` reserves. The semantic
prescription is registered under protocol major 18 as
`analytics-date-range-array-two-bounds-required`.

### What changed

`AnalyticsDateRangeSchema`'s array arm was `z.array(z.string())` with **no length
constraint**, so `['2026-01-01']`, `[]` and `['a', 'b', 'c']` were schema-valid.
It is now `z.tuple([z.string(), z.string()])` — a tuple rather than a length
refinement, so the arity is stated to the author's compiler before any parse runs.
Preset names, two-bound windows and an absent `dateRange` parse byte-identically
to before.

`analyticsDateRangeRefusalMessage(input)` becomes
`analyticsDateRangeRefusalMessage(input, origin)`, where `origin` is `'schema'` or
`'runtime'` and is **required** — there is deliberately no default.

### Migration: FROM → TO

| You wrote | Write instead |
| --- | --- |
| `dateRange: ['2026-01-20']` | `dateRange: ['2026-01-20', '2026-01-20']` — a single day is that day as both bounds, the shape the shipped #16322 table already prescribes |
| `dateRange: []` | no conversion. An empty array names no window: write the two bounds the widget was meant to show, or omit `dateRange` (it is optional, and absent means the query is not time-bounded) |
| `dateRange: ['a', 'b', 'c']` | no conversion. Decide which two bounds you meant and write them |
| `analyticsDateRangeRefusalMessage(value)` | `analyticsDateRangeRefusalMessage(value, 'schema')` at a parse door, `…(value, 'runtime')` past one |

`os migrate meta --from 17` emits the first three as a structured TODO rather than
rewriting them: rewriting a one-element array to the same day twice at load would
be the platform deciding, silently, that the author meant one day rather than a
window whose end they forgot, and for the other two shapes there is nothing to
decide from.

### Why it is not a new class of breakage

Since PR #17593 all four analytics faces (`ObjectQLStrategy`, `NativeSQLStrategy`,
the draft-preview evaluator, `DatasetExecutor.runCompare`) already refused anything
that is not exactly two bounds with `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED`, so
every stored range this narrowing refuses was **already failing at query time**.
The contract door was looser than every reader behind it; this moves the refusal
to authoring time and states it accurately. Blast radius is the WIDGET, not the
page: a stored dashboard carrying a now-refused range loses that widget with the
refusal shown and still loads.

### The wording half

The shared sentence ended `"Refused at the schema"` and described every refused
array as `"received an array with a non-string bound"`. For a one-element window
refused by a face **both clauses were false** — every bound present is a string,
and it was refused past the schema, not at it — which is why
`@objectstack/service-analytics` had to overwrite the message rather than reuse it,
leaving one condition with two wordings. The origin is now a parameter and the
`received …` clause names the arity and the bad bound separately, so the sentence
is true for each origin both before and after the arm narrows.

The same rule reaches the WIRE. Narrowing the arm to a tuple gave the union a
second voice: its arm answers `Too small: expected array to have >=2 items` for
the very arity the prescription just prescribed, and the ADR-0114 union
expansion emitted both as `fields[]` entries on `POST /analytics/query` and
`POST /analytics/dataset/query`. `fieldsFromZodIssues` (`@objectstack/types`),
the one mapper both doors report through, now drops the branch issues that land
at the union's OWN path for this refusal — recognised structurally through
`isAnalyticsDateRangeRefusalIssue`, never by message prose. A refusal that names
a DEEPER position keeps it: `dateRange: ['2026-01-01', 3]` still reports
`timeDimensions.0.dateRange.1`, because WHICH bound is not a string is a
location the prescription does not carry. Every other union expands exactly as
before. Client-visible effect: one `fields[]` entry for an arity refusal instead
of two, with the prescriptive one kept.
