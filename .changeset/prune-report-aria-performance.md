---
"@objectstack/spec": minor
---

feat(spec)!: prune the dead `aria` / `performance` props from ReportSchema (report-liveness close-out)

Follow-up to the #3463 report cleanup. The 2026-06 ReportSchema liveness audit
flagged `aria` and `performance` as dead — declared on `ReportSchema` (and
editable in the Studio report form) but read by **no renderer**. This removes
them. Every other finding from that audit is now closed too: `chart` turned out
to be **live** (`DatasetReportRenderer` plots `chart.xAxis`/`yAxis` via
`DatasetReportChart`), and the obsolete sub-schemas / naming-drift / joined-preview
items were resolved by #3463 and earlier work.

- Removed `ReportSchema.aria` (`AriaPropsSchema`) and `ReportSchema.performance`
  (`PerformanceConfigSchema`), dropping the now-orphan imports. Both schemas
  remain exported and are still used by other metadata types (views, pages,
  charts) — only the report's use of them is removed. `ReportChart` keeps its
  own `aria` (inherited from `ChartConfigSchema`).
- No manifest key or public export changes (`aria`/`performance` were properties,
  not schemas); `report.mdx` regenerated.

**Migration**: nothing an author writes changes — no first-party or example
report set `aria`/`performance`. Reports carry no ARIA/performance overrides;
use the dataset/view surface for those concerns. Ships as `minor` per the
launch-window breaking-as-minor policy.
