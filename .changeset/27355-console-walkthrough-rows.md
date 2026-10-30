---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

fix(ui): four KPI tiles sit two across on a phone, a calendar's footer says its count is the loaded dates', and the record not-found page says the record may also be one you cannot read

Clause-②: no
Metadata-protocol: none

Three console rows from a full HotCRM browser pass:

- **A layout `grid` with a bare `columns` of 4 or more draws two tiles across on a phone** (below `sm`), then the authored count from `md`. A home page's KPI strip (`columns: 4` over `object-metric` tiles) took a row per tile and filled the first screen; it now reads as the dashboard's own phone layout for metric tiles. A bare 2 or 3 still stacks on a phone and pairs from `sm`, and an authored breakpoint object (`columns: { xs: 1, md: 4 }`) is drawn as written.
- **A calendar view's footer says `N records loaded for these dates`.** The calendar fetches the window of dates it draws, so the footer's count is that window's records, not the view's total; it read "N records", the words a grid uses for the whole view. A grid, a board and a calendar over rows handed in whole keep "N records". New count family `list.calendarRecordCount` in all ten packs.
- **The record not-found page says the record "does not exist, may have been deleted, or you may not have access to it".** The server answers a record the reader may not see the same as a missing one (`404 RECORD_NOT_FOUND`, so existence is never revealed), so the page cannot tell the two apart and now names both. `empty.recordNotFoundDescription` and `detail.recordNotFoundDescription` change in all ten packs.
