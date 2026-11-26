---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches the board's lane statistic and card settings

Clause-②: no
Metadata-protocol: none

The kanban example in `rules/list-views.md` now writes `kanban.summary` in place of the older sum-only `summarizeField`, and sets `showFieldLabels` and `hideEmptyFields` with their defaults (both `true`). One note names the six lane statistics (`none`, `count`, `sum`, `avg`, `min`, `max`), says the four aggregates cover every record of the lane and not only the loaded cards, names the known gap (a board over a lookup field or in a grouped view), and says `summary` takes precedence over `summarizeField`. Text only; restating comments and sentences in the same file are cut to pay for it.
