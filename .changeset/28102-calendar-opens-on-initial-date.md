---
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-view': patch
'@object-ui/types': patch
'@objectstack/spec': patch
---

fix(plugin-calendar): a calendar opens on the date its `calendar.initialDate` declares

Clause-②: yes
Metadata-protocol: none

`calendar.initialDate` is now read where `ObjectCalendar` seeds the date it opens on. Before, every calendar opened on today whatever the key said, so a renewals calendar whose records fall months ahead opened on an empty month.

- **Absent:** today, as before.
- **A wrapped date-macro token** (`{today}`, `{next_month_start}`, `{3_months_from_now}`, …): the date the token resolves to when the calendar opens, through the same `resolveDateMacros` resolver filter values use.
- **`first_record` / `next_record`:** one extra one-row read — the view's filter, plus a present start date (`first_record`) or a start date on or after the start of today (`next_record`), sorted by the start field ascending, one row — and the calendar opens on that record's start date. A `date` start field is bounded as a calendar day, any other as the instant of local midnight. No qualifying record, or a failed read, opens on today.

The calendar shows the month, week or day of its active mode that holds the date. The seed happens once, on mount: after it, the user's navigation owns the date, and an anchor answer that arrives after the user has navigated is discarded.

Both producers of the `object-calendar` node — a list view's calendar branch (`ListView`) and `ObjectView`'s generated calendar view — now forward `initialDate` inside the node's `calendar` block; before, they forwarded the block's five field bindings by name and dropped it. The `[PLANNED — not yet rendered]` marker is gone from `CalendarConfigSchema.initialDate`'s description, which now reads one sentence per form, and the `calendar` registry input descriptions of `object-calendar` and `list-view`, plus the designer's `calendar` options type, list the key.
