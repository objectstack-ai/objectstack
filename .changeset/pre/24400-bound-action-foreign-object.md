---
'@objectstack/spec': minor
'@objectstack/objectql': minor
---

feat(spec,objectql)!: a top-level action bound by `objectName` to an object another package owns is listed on that object wherever it is served, and a bound action whose object no loaded package registers fails the boot

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, option, error code or stored shape is added, removed or renamed: `defineStack` accepts two more target kinds for an action's existing `objectName`, the served object gains entries in its existing `actions` array, and the boot refusal answers the existing `INVALID_METADATA` code. Nothing stored changes shape, so `objectstack migrate meta` has nothing to rewrite. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); no Zod schema shape in packages/spec changes (not runtime-interface-only or type-surface-only); and nothing exported is retired (not runtime-export-retired). -->

**BREAKING** (one narrowing beside a widening), shipped as `minor` under the launch-window convention for breaking changes.

- **Widening** (`@objectstack/spec`, `@objectstack/objectql`): an action declared in a stack's top-level `actions` with `objectName` naming an object that another package owns now reaches that object. `defineStack()` accepts the action when the stack extends the object through `objectExtensions`, or when the object is a known platform object (`sys_organization` and the rest of the platform's named list). It keeps the action in the top-level `actions`. The engine's schema registry then attaches it to the object at the one step every object read ends in. That covers `GET /api/v1/meta/object/<name>` (stored-row, MetadataService and registry layers alike), `engine.getSchema()` and the action router's object lookup, in whichever order the two packages register. The attached entry is the action's own declaration, so its `requiredPermissions`, `requiresMembershipReach` and execution identity are unchanged. An action the object already declares under the same name keeps the object's declaration. A disabled package's bound actions are not attached. Before this, such an action was refused by `defineStack()` whenever the stack declared an object of its own. Where it got through (an object-less stack, or `strict: false`), it registered but was listed on no object, so no client rendered it.
- **FROM** (`@objectstack/objectql`): a top-level action bound by `objectName` to an object no loaded package registers was registered and listed nowhere, and the boot succeeded. **TO:** the boot fails at `kernel:ready` with `INVALID_METADATA` (422), naming each such action, its package and the object. An artifact registered through the `manifest` service after the boot is refused before any of it registers. **Fix:** register the object (in the package or in one it depends on), or correct the action's `objectName`.
- **Unchanged:** a name `defineStack()` cannot attribute (an object this stack neither defines nor extends, and not a known platform object) is still refused at build with `STACK_CROSS_REFERENCE_INVALID`. A same-stack bound action is still merged into its object by `defineStack()` and is attached once.

The `ObjectExtensionSchema` refusal for `actions` now says exactly this: declare a top-level action with `objectName: '<target>'` in the same stack; the schema registry attaches it to the object wherever the object is served; a target no loaded package registers fails the boot.
