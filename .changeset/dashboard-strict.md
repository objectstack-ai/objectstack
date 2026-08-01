---
'@objectstack/spec': minor
---

The dashboard's header, filter bar and root reject unknown keys — the posture its widget was rescued from three releases ago.

`DashboardWidgetSchema` has been `.strict()` since the ADR-0021 cutover, and its error map states the reason in its own words: undeclared keys "were dropped silently before strict validation, shipping inert metadata". Everything *around* the widget kept the posture the widget was rescued from — the header, the header actions, the global filters and their option sources, the date range, and the dashboard root itself.

Closed with `strictObject`, so each now names its surface, echoes the offending key, and suggests the nearest declared one. The aliases are the vocabulary of a dashboard: `charts`/`components`/`cards`/`tiles` → `widgets`, `filters` → `globalFilters`, `refresh`/`autoRefresh`/`pollInterval` → `refreshInterval`, `dateFilter`/`timeRange` → `dateRange`.

Three wrong-layer keys get a prescription rather than a rename, because a rename would be wrong:

- **`layout` on the dashboard.** It reads like a template selector; there isn't one. Each *widget* carries `layout: { x, y, w, h }`, and a widget with none is auto-flowed into the grid.
- **`subtitle` on the header.** The header renders the dashboard's own `label`/`description` — there is no separate header copy, only `showTitle`/`showDescription` to toggle them.
- **`filterBindings` on a global filter.** The binding runs the other way: a *widget* maps this filter's `name` to one of its own fields, or `false` to opt out.

Deliberately left open: `DashboardWidgetOptionsSchema` stays `passthrough`. It is the renderer-extras escape hatch by design — presentation settings the renderer understands are none of the spec's business — and the four keys in it that *do* reach the analytics query are already declared explicitly (framework#3588). Closing it would break the escape hatch to fix a problem that was already fixed the right way.

Also unchanged: the widget's bespoke `strictWidgetAnalyticsError`, which carries the pre-ADR-0021 inline-analytics and objectui-internal prescriptions. It works and is tested; converging it onto `strictObject` (which would add "did you mean" suggestions on top of those prescriptions) is a follow-up, not a prerequisite.

Registered types closed at the top level: **23 of 25**. Still open: `action`, `view` — and they are the last two, so the unknown-key *warning* layer is down to two covered roots. When both close it has nothing left to warn about at a root, which is the campaign finishing rather than the layer breaking; the test says so in place rather than being deleted.

One thing surfaced while re-pointing a test at `view`: a single unknown key on a view reports **twice**, because `view` is a union (container | ViewItem | overlay) and the walk emits one finding per strip-mode variant the key lands in. Recorded in the test rather than dodged by picking a non-union collection; it becomes moot when `view` closes.

Authoring impact: a key none of these shapes declares is now rejected instead of silently discarded — it was already being ignored, so no working dashboard changes.
