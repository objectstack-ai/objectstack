---
'@objectstack/spec': minor
'@objectstack/core': patch
'@objectstack/lint': patch
'@object-ui/core': patch
---

feat(spec, core, ui): `{current_iso_week}` defaults a week-keyed filter to the current ISO week

Clause-②: yes (widening: the closed filter-placeholder vocabulary gains one token)
Metadata-protocol: added

A dashboard whose rows carry a text week key (`cost_week: '2026-W47'`) could only default its week filter to a fixed week, which went stale the next Monday. Write the placeholder instead and the filter opens on the current week each time:

```ts
globalFilters: [
  { field: 'cost_week', label: 'Week', type: 'text', defaultValue: '{current_iso_week}' },
],
```

- It resolves to the ISO-8601 week key of today, `YYYY-Www`: Monday-start weeks, week 1 is the week that holds the year's first Thursday, and the year is the ISO week-numbering year, so 2027-01-01 is `2026-W53` and 2025-12-29 is `2026-W01`. "Today" is the day in the workspace time zone, on the server and in the browser alike; the label is the one the analytics week bucket already uses.
- It is a period key, not a date. It lives in its own closed list, `PERIOD_KEY_TOKENS`, beside `DATE_MACRO_TOKENS` and not inside it, so a date filter default and a calendar `initialDate` still refuse it. `classifyFilterToken` answers a new kind, `period-key`, and `isKnownFilterToken` knows it, so lint, flow filter operands and the server resolver accept it wherever a filter placeholder is accepted.
- The server resolves it in `resolveFilterTokens`; the browser resolves it in `resolveFilterPlaceholders` and in the dashboard filter defaults (every filter type except `date` and `dateRange`), so the filter box opens showing the resolved key. A literal `2026-W47` default keeps working and stays fixed.
- Every filter and default written before parses and resolves exactly as before. Only the whole value is a placeholder: `'week {current_iso_week}'` is left as written. A near spelling such as `{currentIsoWeek}` is still refused as an unknown token.
- Use it only on a field that stores week keys. On a date or datetime field the key is compared as text, not read as a week, so the answer is wrong; filter those with the `this_week` preset or `{current_week_start}` / `{current_week_end}`.
