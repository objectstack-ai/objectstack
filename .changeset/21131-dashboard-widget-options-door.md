---
'@objectstack/lint': minor
---

`os validate`, `os build` and `os lint` now warn on a dashboard widget `options` key that no renderer reads, by name, as `unconsumed-widget-option` — the check the SDUI page save gate already ran on a `dashboard` node, now run over dashboard metadata (`*.dashboard.ts`, `defineStack({ dashboards })`).

Clause-②: yes

**What is flagged.** Every key in a dataset-bound widget's `options` outside the read set `CONSUMED_WIDGET_OPTION_KEYS` from `@objectstack/sdui-parser`: `dateGranularity`, `description`, `limit`, `sortBy`, `sortOrder`, `stageOrder`. `DashboardWidgetOptionsSchema` stays open (`.passthrough()`), so such a key still parses; it just stops being silent. Typical cases are `icon`, `columns`, `format`, `currency`, `color`, `suffix`, `showLegend` and `horizontal`, none of which styles anything on a widget bound to a dataset, and a misspelled declared key such as `sortDirection` or `granularity`. The finding is reported at `dashboards[N].widgets[M].options`, and its message names the key.

**Where presentation goes instead.** A number's format and currency are the dataset measure's `format` and `currency`; a tile's accent is the widget's `colorVariant`; a chart's look is the widget's `chartConfig`.

**Same check, same level, same exemptions.** The rule is `validateDashboardWidgetOptions`, exported from `@objectstack/lint` and registered for all three commands. It calls `checkDashboardWidgetOptions` from `@objectstack/sdui-parser` and keeps its `warning` level and `code`. Widgets with no `dataset`, legacy `component` widgets and widgets carrying `suppressWarnings: ['unconsumed-widget-option']` are not flagged. It does not run on the Studio/REST/MCP publish path.

**What changes for a project.** Nothing is refused, and nothing changes without `--strict`. `os validate --strict` and `os lint --strict` now exit 1 instead of 0 on a stack that was otherwise warning-clean and writes such a key. Across this repository's example apps (`app-crm`, `app-todo`, `app-showcase`, `app-multi-package`), no dashboard writes one: zero findings, and no example's exit code changes. To clear the warning, delete the key, or move the intent to the home named above.
