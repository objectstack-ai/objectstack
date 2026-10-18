---
'@objectstack/verify': patch
---

fix(verify): the dashboard date-window family also proves sums and derived measures, and says why an average stays out

Clause-②: no (no export, option or type moves: the family reads the measures it already read, and a widget it used to exclude can now be proven or contradicted)

`runDashboardWindowProofs` (and `os verify --dashboard-windows`) now judges every verdict in fixture rows, so it compares every measure whose difference can be read back as rows:

- **A `sum`** is probed. Each fixture row holds the summed field to the value the CRUD derivation synthesizes for it, or to the value the widget's own selection already holds there. The sum's difference over that value is the rows the window took in. FROM: a sum-only widget was `excluded` (`no-count-measure`), and a sum beside a count was an `excluded` measure (`not-a-count`). TO: `proven` or `contradicted` like a count. A sum of a relationship path, a summed field with no synthesizable value, and a held value that is not a non-zero number are `excluded` as `count-field-unsynthesizable`, and the reason names which.
- **A `derived` measure** (`ratio`, `sum`, `difference`, `product`) is probed through its operands, which the widget's own answer carries beside it. Each operand must be a count or a sum of the same dataset, and the fixture rows meet every operand's filter. Under each preset every operand must take in exactly the rows the window selects. The value the widget shows must equal `evaluateDerivedMeasures` (the server's own evaluator, from `@objectstack/service-analytics`) over that row's operands, or the preset is `contradicted` and the detail names both values. A derived measure over a derived one, or over a measure that is not a count or a sum, stays `excluded` (`not-a-count`), and the reason names the operand.
- **An `avg`, `min`, `max` or `count_distinct`** stays `excluded` (`not-a-count`, or `no-count-measure` for a widget with nothing else), with a reason that says why. What a fixture row does to it depends on rows the app already holds in the window: their number for an average, their extreme for a minimum or maximum, their values for a distinct count. Nothing the widget answers reveals that, so deriving it would mean guessing the data. The reason text changes: FROM `"avg_effort" aggregates avg of effort, not a row count` TO `"avg_effort" averages effort: an average is not additive — …`.
- The widget-level `no-count-measure` reason reads `no measure the widget selects can be compared (…)`. The `excludedKind` values are unchanged.
- **A new `not-run` cause.** The family gives up on a preset when a sum's own total is so large that its floating-point difference cannot resolve one fixture row. That needs 2^34 times the held value, and the detail says so.
- **Upgrading:** on an app whose dashboards bind sums or derived measures, `os verify --dashboard-windows` now probes those widgets. A window that does not reach them now fails the run (`hardFailures`), where before they were only counted as `excluded`.
