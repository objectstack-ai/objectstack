---
'@objectstack/spec': minor
---

feat(spec): a calendar view can declare the date it opens on, `calendar.initialDate`

Clause-②: yes (widening)
Metadata-protocol: added

A calendar view used to open on the current month, always, so a calendar whose records all fall months ahead (a renewals calendar) opened on an empty grid and the author had no key to say otherwise. `CalendarConfigSchema` (the list view's `calendar` block, and the `object-calendar` node's `calendar` prop, which is the same block by reference) gains one optional key:

- **`initialDate`, one of two forms.** A record anchor: `'first_record'` opens on the period containing the earliest start date (the `startDateField` value) among the records the view selects, and `'next_record'` on the period containing the earliest start date on or after today among those records; when no record qualifies, the calendar opens on today. Or a wrapped date-macro token, the same formula vocabulary filter values and a dashboard date filter's `defaultValue` already accept (`DATE_MACRO_TOKENS` and the parameterised `{N_unit_ago}` / `{N_unit_from_now}` grammar): `'{today}'`, `'{next_month_start}'`, `'{current_quarter_start}'`, `'{3_months_from_now}'`, resolved each time the calendar opens. The period is the month, week or day the active view mode shows.
- **Absent means today.** The key has no spec-side default, so a calendar stored before it existed parses to exactly the block it stored and opens where it always did. There is no bare `'today'`: `'{today}'` is its one spelling.
- **What is refused.** A fixed calendar date (`'2026-11-01'`) or timestamp, an unwrapped token (`'today'`), an unknown token (`'{next_moon}'`) and any other spelling are refused at `calendar.initialDate`. The message names both forms and points to `DATE_MACRO_TOKENS`, and a bare known token is told the wrapped spelling to write. A fixed date goes stale as time passes; a macro does not.

The Console renderer reads the key in a follow-up change; until then a calendar that declares it still opens on today.
