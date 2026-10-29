---
'@object-ui/app-shell': minor
---

feat(console): the sidebar draws the report index only where the app's navigation declares it

Clause-②: yes (widening)
Metadata-protocol: added

The console no longer injects an "All reports" row at the foot of every app's sidebar. The app's report index (`/apps/APP/reports`) is an entry its navigation declares, a `report` item with no `reportName`, drawn and highlighted like any other entry; an app whose navigation declares none shows no index entry. With no `label`, the entry shows the console's own name for the index ("All reports"). The ⌘K palette offers the declared entry, and keeps finding every report the member may open from the reports the app ships, entry or not.

In the Studio, a `report` entry with no report chosen reads as the report index (「报表索引」 / "Report index") instead of an unbound entry, and a save keeps it. The metadata editor's navigation inspector matches it: the report picker leads with a "Report index" row, and picking it removes `reportName` from the entry rather than saving `reportName: ''`.

**Migration.** An app that relied on the injected row adds one entry to its navigation where the index belongs: `{ id: 'nav_reports', type: 'report' }`.
