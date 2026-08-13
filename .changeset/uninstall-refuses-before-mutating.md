---
"@objectstack/objectql": patch
---

fix(objectql): a refused package uninstall now mutates nothing (#7970)

`SchemaRegistry.uninstallPackage` has one step that can **refuse**:
`unregisterObjectsByPackage`, which throws when the package owns an object
another package `extend`s (ADR-0029 — the refusal that tells an operator to
uninstall the extenders first). That guard exists to keep a registry whole, and
it was reached **through** mutations, so exercising it half-tore down the very
package it was protecting. Two limbs were exposed:

- **The namespace.** `uninstallPackage` released it before calling the refusing
  verb. A refused uninstall therefore left the package installed — record,
  objects and items all intact — while its namespace no longer resolved, for the
  life of the process. The invariant was already written three lines below the
  defect ("a refused uninstall must remove nothing at all"); the code above it
  did the opposite.
- **The package's other objects.** `unregisterObjectsByPackage` decided the
  refusal one object at a time, inside the walk that removes them, so a package
  owning `account` (free) and `contact` (extended) lost `account` on its way to
  refusing over `contact`.

Both are fixed by ordering, not by a transaction or a second probe: the refusing
verb runs first in `uninstallPackage`, and the verb itself now decides the
refusal across every object before removing any. A throw from
`unregisterObjectsByPackage` is a no-op, which is what lets its callers run it
ahead of their own mutations.

Unchanged: the refusal's message and the object it names, the `force: true` path
(which skips the refusal and removes exactly what it removed before), and the
successful uninstall's observable outcome. Grade is **latent** — no in-tree
caller reaches the refusal path today, so no shipped behaviour was
observably broken; this restores the invariant before one does.
