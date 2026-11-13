---
'@objectstack/runtime': patch
---

fix(runtime)!: an action authored in the environment and bound to an object a package ships is the environment's action, listed once by MCP `list_actions` with no namespace and run by its face

Clause-②: yes (narrowing)
Metadata-protocol: none

BREAKING, in three places, for an action the environment authored (no `?package=`) on an object a package ships:

1. MCP `run_action` with that package's `namespace` answers `RESOURCE_NOT_FOUND` (404) for such an action, as it does for any name that package does not hold. Before, it ran it.
2. `POST /actions/NAMESPACE/OBJECT/NAME` with that package's namespace answers the same 404. Before, it ran it.
3. A flow action of that kind whose `target` flow name TWO packages hold answers `RESOURCE_CONFLICT` (409) naming both holders, on its face, its bare name and `/actions/_env/OBJECT/NAME`. The action has no package (ADR-0150 D3), so its target is read by the no-package rule. Before, it was the object's package's action and ran that package's flow.

- FROM (1, 2): `run_action { actionName: NAME, objectName: OBJECT, namespace: PACKAGE_NAMESPACE }`, or `POST /actions/PACKAGE_NAMESPACE/OBJECT/NAME`.
- TO (1, 2): the face `list_actions` lists for it (`OBJECT-NAME`), the bare name with its `objectName`, or `POST /actions/_env/OBJECT/NAME`.
- FROM (3): an environment-authored flow action on a packaged object whose `target` names a flow two packages hold.
- TO (3): bind the action with `?package=` to a writable package whose own flow, or whose one dependency's flow, is meant, or point its `target` at a flow name one package holds.

The protocol's merged listings serve an action an administrator saved with no `?package=` twice: on its own in the `action` listing, and inside the served object's `actions` in the `object` listing, where the registry attaches it. Neither copy carries a package. The action collector filed it under the package that ships the object, so the ADR-0150 D4 dedupe, which keys on the holder, kept both copies. `list_actions` then listed the action twice, once under a namespace that never shipped it, and refused its face `OBJECT-NAME` as derived for two actions, so `run_action` on that face answered 404.

A copy found inside an object's `actions` that carries no package stamp and is tenant-authored (`_provenance: 'org'`) is now filed under no package, in the collector and in `actionDeclaringPackage`. It lists once, with no namespace, and its face runs it. Unchanged: an action a package ships on its own object lists once under that package's namespace; an action authored with `?package=` lists once under that package's namespace; the environment's action still runs by its bare name and at `/actions/_env/OBJECT/NAME`; a flow action of that kind whose target flow name ONE package holds still runs that flow.

<!-- adr-0087: not-required (no-migration-prescription) no key, export, field or stored body changes; the refusals are of an address that named a package which never held the action, and of a flow target two packages hold read for a caller with no package; the caller's fix is to call the environment's action by its face, its bare name or the _env address, or to bind the action or its target to one package, which no conversion can choose for them -->
