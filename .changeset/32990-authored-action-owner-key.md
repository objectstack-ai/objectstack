---
'@objectstack/objectql': patch
---

fix(objectql): the authored-action resync judges "artifact-shipped" by each holder's owner key, so an environment script action on an object no package's action of that name owns gets its handler (#32990)

Clause-②: yes (widening)
Metadata-protocol: none

On a booted host, `ObjectQLPlugin` binds runtime-authored script actions through the engine's default action runner, and skips a row a code package ships, since that package's handler is bound by the app plugin. The skip asked the registry for an artifact of the bare NAME. When a package shipped an action of that name on any object, an environment-authored script action of the same name on a different object got no handler: its route served the declaration, and the dispatch answered `Action 'NAME' on object 'OBJECT' not found`.

The skip now reads every code package's artifact of the name (disabled packages included) and judges each by the object it owns: a row is artifact-shipped only when one of them owns the row's object, an object-less artifact owning every object. A declared `.custom` override is matched to the artifact on its own object, not to the first package found by name.

FROM: an environment script action `approve` on `lead` beside a package's `approve` on `account` (one or two such packages) had no handler, and its dispatch answered not found. TO: its own body runs. Unchanged: a row on an object a package's action owns (that holder's customization) binds nothing and the holder's handler runs; an object-less package action keeps every other object's row unbound; a disabled holder still owns its object. A declared override of the second-registered of two holders now binds over that holder's handler, where it was missed before.
