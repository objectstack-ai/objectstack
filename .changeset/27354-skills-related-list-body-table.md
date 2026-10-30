---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui and objectstack-data teach a primary related list as a body table in the Details tab, and the relatedLists refusal with its package boundary

Clause-②: no
Metadata-protocol: none

- **Before.** Both skills said a `relatedList: 'primary'` child gets its own tab on the record page, `objectstack-ui` described one tab per primary list plus a shared Related tab and an app-level `relatedLayout` override, and `objectstack-data` said a `relatedLists` name matching no inbound FK is refused, with no boundary.
- **Now.** A primary list is a full-width body table in the details column after the first field section (inside the Details tab, no tab of its own); every other list is a side card in the shared Related tab; field changes join the Timeline tab under its Changes filter. A `relatedLists` child in the stack with no inbound FK is refused everywhere; one that exists nowhere is refused by `os validate` / `os build` and by a metadata write naming no package, while a write into a package stores it and the page places nothing. No ceiling moves; no schema, key or behaviour changes.
