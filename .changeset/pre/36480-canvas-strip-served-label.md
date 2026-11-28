---
'@object-ui/app-shell': patch
---

fix(studio): the canvas selection strip names a selected dashboard widget in the session's language

Clause-②: no
Metadata-protocol: none

On Studio's dashboard design canvas, the status line above the canvas named the selected widget by its authored source title, so a zh-CN session read 「已选中：Pipeline by Stage」 while the widget's property panel beside it read 阶段管道分布. The strip now names a selected widget by the same text the panel's Title box shows: the served, current-language title while the widget's title in the draft still equals the published one, else the draft's own title. It reads that text through the panel's own rule (`shownLabel` over the served widget titles the Studio already pairs with the published layer), so the two never disagree.

Other selections are unchanged: a navigation entry already reads its panel's title, the report canvas selects nothing, and a page block keeps the label its panel shows. No props, exports or stored metadata change.
