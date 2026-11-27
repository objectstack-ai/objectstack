---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui gains an eval case for a board's lane statistic and card settings, and the list-views note says the three keys are optional and that lanes over a lookup field get the whole-lane statistic

Clause-②: no (published prose and an eval case; teaches behaviour already on main)
Metadata-protocol: none

`skills/objectstack-ui/evals/views-apps-actions-pages.json` gains case 27: a board grouped by status whose lanes show `summary: { type: 'avg', field: 'estimate_hours' }`, with `showFieldLabels: false` and `hideEmptyFields: false`.

`skills/objectstack-ui/rules/list-views.md`: the example's two card settings say they are optional with default true; the note says `summary`, `showFieldLabels` and `hideEmptyFields` are optional, that the statistic covers every record of the lane, lanes over a lookup field included, and that omitting `summary` keeps the older `summarizeField` sum (or no statistic without it). The "Known gap" sentence is gone: since #36871 and #37327 a board with lanes over a lookup field reads the whole lane for all five statistics. The file sits at its token ceiling, unchanged.
