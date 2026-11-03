---
'@object-ui/core': patch
'@object-ui/app-shell': patch
---

fix(core): date macros in a filter resolve on the workspace timezone's day, so an authored view's `{today}` and a reader's panel `{today}` name the same day

Clause-②: no
Metadata-protocol: none

- **Before.** `resolveDateMacros` read the browser's clock. A list view's authored filter is resolved in the browser before it is sent, while a reader's filter-panel rule is sent with the macro unresolved and the server resolves it in the workspace `localization.timezone`. When the browser and the workspace were on different days, `close_date between ['{today}', '{today}']` authored on a view asked for one day and the same rule from the panel asked for the other; both on one list sent both days and matched nothing.
- **Now.** The calendar tokens (`today`, `yesterday`, `tomorrow`, the week, month, quarter and year bounds, `N_days` / `N_weeks` / `N_months` / `N_years`) resolve on the day of the display zone `LocalizationProvider` declares from the served `localization.timezone`, the zone the server uses. The instant tokens (`now`, `N_minutes`, `N_hours`) stay on the real instant. With no workspace zone known, the browser's clock decides, as before. The list's authored filter is resolved again when the workspace zone arrives after the first render.
- No signature changes: `resolveDateMacros(filter, now?)` keeps its parameters and reads the zone the date faces already read. Every surface that resolves macros through it (lists, kanban, calendar, gantt, timeline, map, tree, gallery, related lists, grids, dashboards, charts, compare-to, calendar `initialDate`) now names the workspace day too.
