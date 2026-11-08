---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a delegated business-unit walk never starts at a unit outside the caller's organization

Clause-②: no
Metadata-protocol: none

ADR-0105 D6 (red line 2): every business-unit mechanism operates within one organization. A delegated business-unit walk, its root included, covers only units of the caller's organization. The range a self-delegation's anchor is judged against (ADR-0091 D3) is built from such walks, and an anchor outside that range is refused with `403 PERMISSION_DENIED`, whichever organization the unit belongs to; nothing is stored. An anchor inside the range, and an unanchored delegation, are admitted.
