---
"@objectstack/client": patch
---

The README's analytics and automation examples read the resolved payload.

`client.analytics.query` / `analytics.meta` and `client.automation.trigger` stopped handing back the dispatcher's `{ success, data }` envelope in 17.0.0: each resolves to the payload itself. The README's namespace tour still showed all three as bare `await` calls with nothing reading the resolved value, so the package's own front page taught nothing about which shape comes back — neither wrong nor useful. Each of the three now assigns its result and reads one member of it: `report.rows` / `report.fields[0].name` (`AnalyticsResult`), `cubes[0].name` (the bare `CubeMeta[]`), `run.status` (`AutomationResult`) — the members those contracts actually declare, read off the payload rather than off a `data` wrapper.

No behaviour changes; this is the README that ships inside the package. The docs site's Client SDK and Data API pages take the same treatment in the same PR.
