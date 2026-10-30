---
'@objectstack/objectql': patch
---

fix(objectql)!: a composed stack's top-level picklist that no package body declares and no object field names is refused at boot, naming the list and the stack (#28159)

Clause-②: yes (narrowing) — a stack with `packages[]` whose top level declares a picklist that no package body declares and no object field names booted, and now refuses the boot with `INVALID_METADATA` (422)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and the picklist schema accepts what it accepted. The boot refuses one composition it used to accept silently, and the refusal names its own remedy; there is no metadata for a migration to rewrite. -->

**BREAKING** for a composed stack only (a stack that carries `packages[]`). A stack without `packages[]` has no residual and is unchanged.

The engine registers a stack's top-level items that no package body declares (its residual) under the stack's own id, except picklists, which stay metadata only. A residual picklist that an object field names was loud already: a top-level object's field makes that object listed and not served, and a package body's field fails the boot's picklist audit. A residual picklist that no object field names was neither registered nor refused, so the boot booted and the list was missing from the engine with nothing said.

- **Before.** The boot succeeded and the picklist was absent from the engine registry.
- **Now.** The `manifest` service refuses the artifact before anything of it registers, with `INVALID_METADATA` (422). The message names each such picklist and the stack, and gives the remedy. A field counts as naming the list only when the engine registers it: a field of a package body's object or `objectExtensions` entry, or of a top-level object no body declares. A top-level `objectExtensions` entry, a top-level copy of an object a body declares, and a top-level `plugins[]` entry are not registered in a composed stack, so a list that only they name is refused too, as is one that only a body's `picklistExtensions` entry extends.
- **Unchanged.** A residual picklist that an object field names keeps today's behaviour, a picklist a package body declares registers as before, and a stack with no residual picklist boots as before.

**The remedy.** Declare the picklist inside the `packages[]` entry of the package whose objects use it; or name it from a field of the object meant to use it; or remove it from the top level.
