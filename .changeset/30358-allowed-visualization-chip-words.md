---
'@object-ui/app-shell': patch
---

fix: on a zh-CN console, the allowed-visualizations chips in a view's settings read the same Chinese words as the view-type select (#30358)

Clause-②: no
Metadata-protocol: none

The 允许的可视化 chips (`appearance.allowedVisualizations`) were the only English row left in a list view's end-user section on a zh-CN console: they read Grid, Kanban, Gallery, Calendar, Timeline, Gantt, Map, Chart, Tree. They now read 表格 / 列表, 看板, 画廊, 日历, 时间线, 甘特图, 地图, 图表, 树形, the words the view-type select a few rows up already uses. Both controls take the name from one shared helper, so they cannot drift apart. An en-US console keeps the chip names it had. A multi-select over any other list of values keeps its existing names in every language.
