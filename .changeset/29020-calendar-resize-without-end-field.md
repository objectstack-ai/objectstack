---
'@object-ui/plugin-calendar': patch
---

fix(plugin-calendar): a calendar view with no `endDateField` draws no resize-end handle, and a drop that changes no date writes nothing

Clause-②: yes (widening)
Metadata-protocol: none

On a calendar view that declares only `startDateField`, every month-view card still drew the "Resize event end" handle. Dragging it moved nothing, yet wrote the record's unchanged start date, so `updated_at` moved and every after-update trigger and flow ran for an edit nobody made.

- **No end field, no end handle.** `CalendarView` takes a new optional `endEditable` prop (default `true`). When it is `false`, the month view draws no "Resize event end" handle and the week and day views draw no bottom "Resize end" handle; moving a card and the top "Resize start" handle are unchanged. `ObjectCalendar` passes `false` when the view declares no `endDateField`. A view that declares one keeps both handles and keeps writing the end, including on a record whose end is empty.
- **A drop that changes nothing writes nothing.** `ObjectCalendar`'s default drop handler now skips the write when every date it would write is where the record already has it. A press and release on a week-view event without moving it was such a drop, with or without an end field.
