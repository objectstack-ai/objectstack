---
'@objectstack/spec': patch
---

fix(spec): the migration registry template opens its major-19 retired-key and retired-def regions

Clause-②: no
Metadata-protocol: none

On the 19 version tree every retirement `check:authorable-surface` prescribes registers under major 19, and `gen:migration-registry` refused those entries because the template had regions only for 17 and 18. Both tables now carry an empty major-19 region, and a test pins a region of every kind for both the spec package's major and `PROTOCOL_VERSION`'s, so the next major is caught on `main` rather than on the Version PR.
