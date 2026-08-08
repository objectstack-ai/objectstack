---
"@objectstack/spec": minor
---

feat(spec): make the dashboard date-range preset names a single vocabulary and check a date filter's `defaultValue` against it (#4614)

A dashboard's built-in `dateRange` validated its preset name and a
`globalFilters` entry of `type: 'date'` did not, so the same typo was an
author-time error on one surface and a silent wrong answer on the other.

`GlobalFilterSchema.defaultValue` is `string | number | boolean`, which makes a
bare preset name the only spelling available for a date filter's default —
and nothing checked it. An unrecognised name cannot be lifted to a range, so it
fell through to "a bare string date means equality on that day" and reached the
backend as `created_at = 'last_7_dayz'`: a condition no row matches, answered
`200 OK` with a zero. Every tile read `0` while the filter bar showed
"All time", so the dashboard looked deliberately empty rather than
misconfigured — the failure mode that costs the most time to diagnose, and the
one an AI author reads as a correct answer and builds on.

- **`DATE_RANGE_PRESETS`** (+ the `DateRangePreset` type) is new in
  `@objectstack/spec/ui` and is now the vocabulary's single source of truth.
  The thirteen names existed three times before this: inline in
  `dateRange.defaultRange`, as `PRESET_RANGES` in objectui's
  `dashboard-filters` (the module that maps each name to its date-macro
  bounds), and as a hand-written table in the dashboard docs.
- **`DATE_RANGE_DEFAULT_RANGES`** (+ `DateRangeDefaultRange`) is the presets
  plus the `custom` sentinel, and is what `dateRange.defaultRange` now reads.
  `custom` is deliberately not a preset — it names no window, it opens the
  picker — so it stays legal there and is rejected as a bare filter default,
  which has no `from`/`to` for it to hand over. `defaultRange`'s accepted set
  is otherwise unchanged by the extraction, and a test asserts that member for
  member.
- **`GlobalFilterSchema` gained a `superRefine`**: on `type: 'date'`, a
  declared `defaultValue` must be a preset name, an ISO date (`2026-01-15`,
  optionally with an instant), or a known date-macro token (`{today}`,
  `{30_days_ago}`). The macro half asks `isDateMacroToken` rather than
  restating its grammar, so there is one token vocabulary and no second dialect
  to drift. The rejection quotes the offending value back and lists all three
  legal spellings, because a dashboard with several date filters otherwise
  gives no clue which one is wrong. Every other filter type is untouched — a
  `select` filter's values are the author's own vocabulary.

**Existing metadata is unaffected.** The tree's only date-filter default is
`system_overview.dashboard.ts`'s `last_7_days`, which is a valid preset and is
pinned by a test; a corpus scan of the three example apps and the docs found no
misspelled preset name, so no ADR-0087 conversion is required. The accepted set
is a strict superset of what objectui's renderer resolves today, so no
declaration that used to render can stop parsing.

The new exports and the `.describe()` on `defaultRange` are additive; the only
authorable behaviour that changes is that a value which previously parsed and
then silently resolved to nothing is now an author-time error.
