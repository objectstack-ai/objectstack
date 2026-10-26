---
'@objectstack/platform-objects': patch
'@objectstack/console': patch
---

fix(platform-objects): the System Overview's tile captions and column headers are translated in every shipped locale

Clause-②: yes (widening)
Metadata-protocol: none

- **The captions.** Under zh-CN, ja-JP and es-ES the System Overview drew a translated title on each KPI tile and the English measure label under it: `Users`, `Organizations`, `Sessions`, `Installations`, `Events`. The event-volume table and the audit charts were headed `Action` and `User` the same way. Those strings come from the board's datasets, not from the dashboard, and the Setup bundle had no `datasets` block. It now carries `datasets.<name>.measures.<m>.label` and `datasets.<name>.dimensions.<d>.label` for every member the board draws, in `en`, `zh-CN`, `ja-JP` and `es-ES`. The analytics query already localizes a saved dataset before it runs, so nothing else changes on the serving path.
- **Staleness.** `HAND_AUTHORED_SECTIONS` (exported from `@objectstack/platform-objects/apps`) now lists `datasets`, and the new translations carry recorded source hashes. When a dataset label is edited, the translated locales serve the new English until they are re-translated, as `apps`, `dashboards` and `pages` already do.
- **Console.** The Audit Log's `IP` column header reads `console.system.auditLog.ipAddress` ("IP 地址" under zh). A Beta settings page's title carries a space between the name and the badge in its text ("Feature Flags Beta").

What to do: nothing.
