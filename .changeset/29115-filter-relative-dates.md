---
'@object-ui/components': patch
---

feat(components): the filter panel offers relative dates on date rows, stored as date-macro tokens

Clause-②: no
Metadata-protocol: none

A `date` or `datetime` row of the filter builder (the list filter panel, and the other surfaces that share the builder) now offers relative dates beside a fixed date:

- **`between`** offers the 13 date-range presets of `@objectstack/spec` (`DATE_RANGE_PRESETS`, in that order: today, yesterday, this week, … last 90 days) beside `Custom…`, which keeps the two date inputs. A chosen preset is stored as the spec's macro window from `DATE_RANGE_PRESET_MACRO_WINDOWS`, for example `['{week_start}', '{week_end}']`.
- **`before` / `after`** offer today, yesterday and tomorrow beside `Custom…`. A chosen point is stored as the wrapped token, for example `'{today}'`.

The stored rule stays an ordinary `ViewFilterRule`: no operator, key or value kind is added, a preset name is never stored, and the query resolves the tokens when it runs, so a filter saved as "this week" still means this week next Monday. A stored pair reads back as its preset (the `{current_*}` aliases fold first: `['{current_week_start}', '{current_week_end}']` shows "This week"); a placeholder value no preset matches, such as `['{7_days_ago}', '{tomorrow}']`, is kept, shown as its text, and still filters. A stored fixed date shows as `Custom…` with its date, as before, and still means that day.

The labels reuse the keys the dashboard filter bar and the date picker already translate (`dashboard.filters.range.*`, `dashboard.filters.custom`, `fields.datePicker.tomorrow`). Relative values on `equals` are not offered.
