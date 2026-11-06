---
'@objectstack/skills': patch
---

docs(skills): objectstack-api no longer teaches that `DELETE` is a hard delete with no recycle bin: a by-id delete keeps a business object's rows in `sys_recycle_bin` (30 days by default; not `multi: true` deletes, platform rows or rows deleted before the bin existed), and restore is not exposed yet

Clause-②: no
Metadata-protocol: none
