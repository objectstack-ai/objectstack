---
'@objectstack/skills': patch
'@objectstack/spec': patch
'@objectstack/metadata': patch
'@object-ui/i18n': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/fields': patch
'@object-ui/types': patch
'@object-ui/plugin-form': patch
'@object-ui/console': patch
---

docs(skills): hand-written inventory counts are deleted; the names and the source of truth stay

Clause-②: no
Metadata-protocol: none

- **Before.** `objectstack-data` counted its field types ("49") in SKILL.md and in `rules/field-types.md`, and its lifecycle events ("8") in SKILL.md and `references/data-hooks.md`; `objectstack-automation` counted its built-in node types ("20"); `objectui/README.md` counted its plugins ("18"); `objectui/guides/schema-expressions.md` counted the formula registry ("30 functions"); `objectstack-query` counted the aggregate functions ("six"). No gate reads any of those numbers against the tree, so each one goes wrong the moment the inventory moves, and a wrong count misleads the reader more than no count.
- **Now.** The numbers are gone; every enumeration that taught something (the node-type tables, the plugin names, the function table, the aggregate names) stays, and each page still points at the file or schema that is the source of truth. Deletion only: every touched file shrinks under its unchanged token ceiling.
- The same deletion in shipped READMEs and one shipped source comment: `@objectstack/spec` (a `//` comment in `src/kernel/metadata-plugin.zod.ts`, which ships), `@objectstack/metadata` (README), and the `@object-ui/*` READMEs of i18n, plugin-grid, components, fields, types, plugin-form and console. No schema, key or behaviour changes.
