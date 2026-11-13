---
'@objectstack/runtime': patch
---

fix(runtime)!: an action authored in the environment and bound to an object a package ships is the environment's action, listed once by MCP `list_actions` with no namespace and run by its face

Clause-②: yes (narrowing)
Metadata-protocol: none

BREAKING: naming the package that ships the object no longer reaches an action the environment authored on that object. MCP `run_action` with that package's `namespace`, and `POST /actions/NAMESPACE/OBJECT/NAME`, answer `RESOURCE_NOT_FOUND` (404) for such an action, as they do for any name that package does not hold. Before, both ran it.

- FROM: `run_action { actionName: NAME, objectName: OBJECT, namespace: PACKAGE_NAMESPACE }`, or `POST /actions/PACKAGE_NAMESPACE/OBJECT/NAME`, for an action authored with no `?package=`.
- TO: the face `list_actions` lists for it (`OBJECT-NAME`), the bare name with its `objectName`, or `POST /actions/_env/OBJECT/NAME`.

The metadata service serves an action an administrator saved with no `?package=` inside the served object's `actions` as well as on its own, and that served copy carries no package. The action collector filed it under the package that ships the object, so the ADR-0150 D4 dedupe, which keys on the holder, kept both copies. `list_actions` then listed the action twice, once under a namespace that never shipped it, and refused its face `OBJECT-NAME` as derived for two actions, so `run_action` on that face answered 404.

A copy found inside an object's `actions` that carries no package stamp and is tenant-authored (`_provenance: 'org'`) is now filed under no package, in the collector and in `actionDeclaringPackage`. It lists once, with no namespace, and its face runs it. Unchanged: an action a package ships on its own object lists once under that package's namespace; an action authored with `?package=` lists once under that package's namespace; the environment's action still runs by its bare name and at `/actions/_env/OBJECT/NAME`, and a flow action of that kind still reads its target flow by bare name.

<!-- adr-0087: not-required (no-migration-prescription) no key, export, field or stored body changes; the refusal is of an address that named a package which never held the action, and the caller's fix is to call the environment's action by its face, its bare name or the _env address, which no conversion can make for them -->
