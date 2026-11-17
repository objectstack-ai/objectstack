---
'@object-ui/plugin-detail': patch
---

fix(ui): in a narrow record drawer a relative time stays on one line

Clause-②: no
Metadata-protocol: none

The record page's meta line ("Updated by NAME · 2d ago") and the activity timeline's entry, folded-run and reply headers now keep the relative time, with its leading dot where it has one, as one piece that never breaks. Their rows wrap between pieces instead, so in a narrow drawer the whole time moves to the next line rather than breaking word by word ("2 / days / ago", "3" over "天前"). Wide layouts are unchanged: when the row fits, nothing wraps.
