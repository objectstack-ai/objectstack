---
'@objectstack/skills': patch
---

docs(skills): the query skill teaches the `{current_iso_week}` period key

Clause-②: no
Metadata-protocol: none

objectstack-query's `rules/filters.md`, section "Date Macros", now names the period key beside the date macros and the session tokens. `{current_iso_week}` (or `${current_iso_week}`) resolves to today's ISO week key, `YYYY-Www`, in the workspace time zone: Monday-start weeks, the ISO week-year at year edges. It is text, for a text field that stores week keys. A `date`, `datetime` or `time` field refuses it with `INVALID_FILTER` / 400, as it refuses the literal key; a date dashboard filter's `defaultValue` and `calendar.initialDate` refuse it too. On a date field write `{current_week_start}` / `{current_week_end}`. The section also names `resolveFilterPlaceholders()` as the client resolver for all three vocabularies and `isKnownFilterToken()` as the one spelling check. One eval case covers the text-field / date-field split.
