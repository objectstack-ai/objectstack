---
'@object-ui/plugin-calendar': patch
---

fix(plugin-calendar): a calendar with no end-date field draws no resize handle in the week and day views, and the `calendar-view` renderer forwards a host's `endEditable`

Clause-②: no
Metadata-protocol: none

A calendar view that declares no `endDateField` shows each event as a point in time. The week and day views still drew the top "Resize start" handle on such an event: dragging it rewrote the start and redrew the event an hour long, so it read as a move.

- **No stored end, no resize handle.** `CalendarView`'s `endEditable={false}` now also hides the time grid's top "Resize start" handle, so the week and day views draw no resize handle at all; moving an event by its body is unchanged. `ObjectCalendar` already passes `false` when the view declares no `endDateField`. A view that declares one keeps both handles.
- **`calendar-view` forwards `endEditable`.** A React host rendering a `calendar-view` node can pass a boolean `endEditable`, forwarded the way `slotMinutes` is; any other value gets the default. It is not derived from the node's `endDateField`, which defaults to `end`.
