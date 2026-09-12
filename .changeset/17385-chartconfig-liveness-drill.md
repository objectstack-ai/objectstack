---
"@objectstack/spec": patch
---

**Clause-②: no** — no schema key moves, no accept set widens or narrows, no export changes. This is the liveness ledger stating what the renderer actually does with an authored `chartConfig`, at one verdict per key instead of one blanket verdict for fourteen.

`packages/spec/liveness/dashboard.json`'s `widgets.chartConfig` row is **drilled**: it now carries `children`, one status + evidence per `ChartConfigSchema` key, re-measured against this checkout's own `.objectui-sha` pin `53ded82bf7a4`. The row ships — `packages/spec` publishes `liveness/` whole — so this changeset is a measurement, not a convention: `npm pack --dry-run` puts `liveness/dashboard.json`, `liveness/README.md` and `liveness/state-counts.md` in the tarball (38 files under `liveness/`), and the fourth changed path, the undrilled-containers baseline under `scripts/`, is not in it (0 files under `scripts/`).

Per-key verdicts, all pinned in the renderer repo:

- **12 live.** Nine chrome keys are lowered onto the chart schema by `chartConfigPresentation`, one guard each — `title`, `subtitle`, `description`, `colors` (split two ways into the positional palette and the per-category map), `height`, `showLegend`, `showDataLabels`, `annotations`, `interaction`. `xAxis`, `yAxis` and `series` join them by a different route: `mergeAuthoredPresentation` merges their **presentation** onto the bindings the dataset selection derived, dropping exactly the two binding keys `ChartAxis.field` and `ChartSeries.name` so that series membership and the plotted column stay with the dataset.
- **2 dead.** `chartConfig.type` parses and does nothing on a dashboard widget — the widget's own `type` picks the chart family — and `chartConfig.aria` has no reader on either face: the chart implementation declares no `aria` prop and the ARIA injection reads the flat `ariaLabel` / `ariaDescribedBy` / `role`. Both are pinned as **negatives** by name in the renderer's own tests, which is what makes them re-askable rather than merely asserted.

Neither `dead` verdict is acted on here. Recording a verdict is what feeds the ADR-0049 enforce-or-remove worklist; executing one moves a published accept set and is a separate, ruled piece of work.

The drill also makes six containers one level further down visible for the first time (`xAxis`, `yAxis`, `series`, `annotations`, `interaction`, `aria` — 39 child keys). They are **recorded** in the shrink-only undrilled-containers baseline rather than drilled: fanning this row's verdicts down over them would manufacture verdicts with no evidence behind them, which is the one thing the drill rule forbids by name.
