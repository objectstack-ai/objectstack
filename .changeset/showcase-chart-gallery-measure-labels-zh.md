---
'@objectstack/example-showcase': patch
---

Clause-②: no
Metadata-protocol: none

The showcase Chart Gallery's KPI subtitles now read in Chinese for a zh-CN viewer. The three dataset
measures behind them had no zh-CN entry, so "Tasks", "Projects" and "Total Budget" stayed English on an
otherwise translated dashboard. The zh-CN bundle now carries 任务数, 项目数 and 总预算 for
`showcase_task_metrics.task_count`, `showcase_project_metrics.project_count` and
`showcase_project_metrics.budget_sum`; English is unchanged.
