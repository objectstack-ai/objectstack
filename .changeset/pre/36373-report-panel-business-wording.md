---
'@objectstack/spec': minor
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the report and dashboard-widget panels speak business wording, and opening the report editor keeps the page in the session's language

Clause-②: yes (widening) — the report and widget panels accept an edit of a translated name or title in the session's language, stored as the inline locale map `{ default: SOURCE, LANG: EDIT }` the spec's `I18nLabel` already allows; nothing is removed or renamed
Metadata-protocol: semantic — `translateReport` and `translateDashboard` now treat a report `label`/`description` or a widget `title` as changed when its inline locale-map entry for the requested locale (the entry the panel writes: exact tag, then the locale's own script, else base tag or a sibling region; never `default`) differs from the packaged base's own, so the base's translation no longer replaces it; a translation the paired `.custom` package ships still answers first (ruling record 6631250894), and with none the entry is served; dataset members (`translateDataset`, ADR-0149) are unchanged

The report editor beside a report (runtime 「编辑」 and Studio) and the dashboard widget property bar (Studio, and the dashboard page's edit state) now name things the way a business reader does:

- Fields, measures and data sources show their labels in the current language; the machine name is on hover only (`title`), never printed. A measure reads `LABEL · AGGREGATE` with the aggregate in words (「金额 · 合计」, "Amount · Sum").
- 「行（维度）」「维度」 read 「分组」, 「值（度量）」 reads 「指标」, 「数据集」 reads 「数据来源」 (its label alone, no `(name)` and no description), and the filter-binding section reads 「跟着页面顶部的筛选变」 with each filter by its name (「时间」 for the date range, the dimension's label for a filter with none).
- The chart-type list is Chinese names with their icons (柱状图, 折线图, …), not `bar`.
- The line under the data source is plain words: 「报表从这里取数；每个人只能看到自己有权限的记录。」 — no 「受治理」 or 「RLS」.
- The report form rows below the curated fields (section headings and hints in zh-CN) use the same wording.

The report's name box and a widget's title box show the served (current-language) text while it is untouched, and an edit lands in the session language only: a plain-string source shown translated becomes `{ default: SOURCE, LANG: EDIT }`, so every other language reads exactly what it read before. For a report or dashboard installed from a package (one with a packaged base), the server serves that entry ahead of the package's translation (a translation the paired customization package ships still comes first), so the edit is what the page shows after save. A report with no packaged base keeps the bundle first: where the bundle has an entry for that language, the stored edit does not show.

Fixed: opening the report editor no longer turns the page heading and subtitle from the served 「各阶段商机」 to the English source. The page draws the served text for every translated key the edit has not touched.

This supersedes objectui#11161's `LABEL (name)` and objectui#12303's trailing machine name on these two panels only; other dataset pickers are unchanged.
