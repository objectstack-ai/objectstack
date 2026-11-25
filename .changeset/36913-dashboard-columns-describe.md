---
'@objectstack/spec': patch
---

fix(spec): `DashboardSchema.columns` says what the renderer does when it is absent

Clause-②: no
Metadata-protocol: none

The `columns` describe said "(default 12)". The dashboard renderer has no fixed default: when `columns` is absent it infers the grid from the widgets, 12 if any widget layout reaches past column 4 (`x + w > 4`), otherwise 4. The describe, its TSDoc and the generated reference page now say that. No runtime change.
