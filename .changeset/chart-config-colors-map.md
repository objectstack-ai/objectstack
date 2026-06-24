---
"@objectstack/spec": patch
---

feat(spec): type ChartConfig `colors` as a palette OR a value→color map

`ChartConfigSchema.colors` now accepts either a positional palette (`string[]`)
or an explicit value→color map (`Record<value, color>`, kanban-style). A
value→color map — and a select/lookup dimension's option colors — take
precedence over the positional palette per category, so semantic charts
(health, status) paint their own colors instead of the generic palette.
