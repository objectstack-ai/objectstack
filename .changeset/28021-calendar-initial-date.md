---
'@objectstack/spec': minor
---

feat(spec): a calendar view can declare the date it opens on, `calendar.initialDate`

Clause-②: yes (widening)
Metadata-protocol: added

A calendar view used to open on the current month, always, so a calendar whose records all fall months ahead (a renewals calendar) opened on an empty grid and the author had no key to say otherwise. `CalendarConfigSchema` (the list view's `calendar` block, and the `object-calendar` node's `calendar` prop, which is the same block by reference) gains one optional key:

- **`initialDate: 'today' | 'first_record' | 'next_record'`.** `'today'` opens on the period containing today. `'first_record'` opens on the period containing the earliest start date (the `startDateField` value) among the records the view selects. `'next_record'` opens on the period containing the earliest start date on or after today among those records. When no record qualifies, the calendar opens on today. The period is the month, week or day the active view mode shows.
- **Absent means today.** The key has no spec-side default, so a calendar stored before it existed parses to exactly the block it stored and opens where it always did.
- **A closed set.** A fixed calendar date (`'2026-11-01'`), a date-macro token (`'{today}'`) or any other spelling is refused at `calendar.initialDate` with Zod's `invalid_value`, whose message lists the three accepted values. A date stored on a view goes stale as time passes, which is why a fixed date is not among them.

The Console renderer reads the key in a follow-up change; until then a calendar that declares it still opens on today.
