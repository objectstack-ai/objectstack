---
'@objectstack/platform-objects': patch
---

Clause-②: no

fix(platform-objects): the System Overview dashboard's six metric tiles declare `layout.h: 1`, one row tall, where they declared `2`

The `system_overview` dashboard the Setup app ships (`SystemOverviewDashboard`) authored every one of its six `type: 'metric'` tiles (Total Users, Organizations, Active Sessions, Packages Installed, Login Events, Config Changes) at `layout.h: 2`. The console draws a widget over the grid rows its `h` names, each row floors at 5rem and grows to its content, and a metric card fills its box, so each tile drew a box about twice the height of its content: the title and the number in the top half, the lower half empty. The platform draws what the metadata declares, so the authored size is what is corrected.

- **FROM:** the six metric tiles declare `layout: { …, h: 2 }`.
- **TO:** the six metric tiles declare `layout: { …, h: 1 }`; each now draws at content height.
- **Unchanged:** every `x`, `y` and `w`, the chart and table widgets (`h: 4`), every widget id, filter and binding, and every export.
- **An org that already published an overlay of `system_overview`** is served that overlay as stored (ADR-0126 Regime O), so it keeps the tile heights it was saved with.
