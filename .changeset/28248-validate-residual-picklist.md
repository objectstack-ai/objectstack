---
'@objectstack/cli': patch
'@objectstack/metadata': patch
'@objectstack/spec': patch
---

fix(cli)!: `os validate` and `os build` refuse a composed stack's top-level picklist that the boot refuses (#28248)

Clause-②: no (narrowing) — `os validate` and `os build` refuse a composed stack whose top level declares a picklist that no package body declares and no object field the engine registers names, which they accepted before; the boot already refuses every such stack, so nothing that boots is newly refused, and nothing is widened
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and the stack schema accepts what it accepted. The two authoring doors now give, ahead of the boot, a refusal the boot already gives, with the same remedy; there is no metadata for a migration to rewrite. -->

**BREAKING** for `os validate` / `os build` on a composed stack only (one that carries `packages[]`), and only for a stack the boot already refuses.

A composed stack (one that carries `packages[]`) whose top level declares a picklist that no package body declares, and that no object field the engine registers names, is refused at boot (`INVALID_METADATA`). `os validate` and `os build` used to pass the same stack, so the author learned of it only at boot.

- **Now.** Both doors refuse it as `picklist-residual-unreferenced`, located at the picklist's top-level index. The message and prescription are the boot's own words: declare it inside the `packages[]` entry of the package whose objects use it; or name it from a field of the object meant to use it; or remove it from the top level.
- **What counts as naming it** is the boot's set: a field of a body's objects or `objectExtensions`, or of a top-level object no body declares. A top-level `objectExtensions` entry, a top-level copy of an object a body declares, and a top-level `plugins[]` entry name nothing, because no door registers them in a composed stack.
- **Unchanged.** A residual picklist that a top-level object's field names is not refused (the boot lists that object and does not serve it). A body field naming a list only the top level declares is `picklist-reference-unknown`, as before. A body-declared picklist and a stack without `packages[]` are not affected.
- **Prose.** The residual-rule header in `@objectstack/metadata` and the permission-set owner gate's docblock in `@objectstack/spec` now state the picklist exception. No schema changes.

No stack that boots is newly refused: every stack this refuses, the boot already refuses.
