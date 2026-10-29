---
'@objectstack/skills': patch
---

docs(skills): hand-written inventory counts are deleted; the names and the source of truth stay

Clause-②: no
Metadata-protocol: none

- **Before.** `objectstack-data` counted its field types ("49") in SKILL.md and in `rules/field-types.md`, and its lifecycle events ("8") in SKILL.md and `references/data-hooks.md`; `objectstack-automation` counted its built-in node types ("20"); `objectui/README.md` counted its plugins ("18"); `objectui/guides/schema-expressions.md` counted the formula registry ("30 functions"); `objectstack-query` counted the aggregate functions ("six"). No gate reads any of those numbers against the tree, so each one goes wrong the moment the inventory moves, and a wrong count misleads the reader more than no count.
- **Now.** The numbers are gone; every enumeration that taught something (the node-type tables, the plugin names, the function table, the aggregate names) stays, and each page still points at the file or schema that is the source of truth. Deletion only: every touched file shrinks under its unchanged token ceiling.
- No schema, key or behaviour changes.
