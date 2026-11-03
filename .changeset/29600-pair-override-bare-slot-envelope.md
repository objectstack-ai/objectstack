---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a `.custom` pair's published override of a dashboard, report or email template no longer sits in the registry under the base's envelope

Clause-②: no
Metadata-protocol: none

A published override of a base's dashboard, report or email template, saved in the base's `<base>.custom` pair, was registered in the registry's bare slot wearing the BASE's artifact envelope (`_packageId` = the base, `_provenance: 'package'`). The base's per-package layer, which the base's export reads, then listed the override beside the base's own item. Views already stayed out of that slot. The override is now kept out of it for these three types as well, and is still served from its stored row. The by-name read, the effective list and the layered read serve exactly what they served before. The base's per-package layer lists only the base's own item, and the pair's layer lists only the override. A registry read that names the base's item directly answers the base's own item. A row of a package that ships its own artifact of the name keeps its entry as before. Nothing to migrate: a restart re-hydrates the registry under the new rule.
