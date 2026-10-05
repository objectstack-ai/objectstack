---
"@objectstack/cli": patch
---

`os lint` and `os i18n extract` ask for a flow's `flows.<flow>.label` translation only when the flow has a screen node at any depth, the only kind of flow the console's screen-flow runner opens and names, so a scheduled, record-triggered or API flow with no screen no longer draws an `i18n/missing-flow` demand for a label no surface shows.

Clause-②: no
