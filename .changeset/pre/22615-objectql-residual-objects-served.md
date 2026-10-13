---
'@objectstack/objectql': patch
---

A top-level object that no package body of a multi-package stack declares is now served by the data door, under the stack's `manifest.id`, the id the metadata door already lists it under

Clause-②: no

- **What was wrong.** A stack that carries `packages[]` registers each package body under that package's id. A top-level object that no body declares is the stack's residual. The metadata door registered it under the stack's `manifest.id` and the boot warned that every door would report that id as its owner. The engine's `manifest` service registered the bodies only. So `GET /api/v1/meta/object` listed the object while `GET /api/v1/data/<name>` answered `404`, on the artifact boot (`os serve` of a built artifact) and on the config boot (`os serve objectstack.config.ts`) alike.
- **What changes.** After the bodies, the `manifest` service registers the residual's objects under the stack's `manifest.id`. It reads which objects are residual from `unclaimedTopLevel` (`@objectstack/metadata`), the same answer the metadata door and `os validate` read. No package record is created for that id: the residual is not a package. When the id names one of the bodies (a composed stack keeps one member's manifest), that body's record is unchanged. A residual object that arrives after boot, with a late artifact, is copied to the metadata service as a body's objects are.
- **Listed and not served, by name.** Registering two classes of residual object would refuse a boot that the stack passes today, so they are not registered. They stay listed by the metadata door and unserved by the data door, and the boot prints one warning naming each object and why:
  - an object whose name another package already owns: the data door keeps serving that package's object;
  - an object with a field that names a picklist no package body declares: the stack's top-level picklists are metadata only, so the boot's picklist check would fail.

  The remedy in the warning is the residual warning's own: declare the object inside the `packages[]` entry of the package that owns it, with every picklist its fields name. To add fields to an object another package owns, use `objectExtensions`.
- **Unchanged.** A stack without `packages[]`, and a normally composed one whose top level repeats its bodies, has no residual and registers exactly as before.
