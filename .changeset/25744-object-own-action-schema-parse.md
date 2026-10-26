---
'@objectstack/objectql': patch
---

fix(objectql)!: an object's own actions are stored as their `ActionSchema` parse, so `requiresFeature` takes effect on a raw manifest's object actions

Clause-②: no (narrowing: an object's own action that fails `ActionSchema` is refused at the runtime registration door, as #25649 did for standalone actions)

Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: `ActionSchema` and `ObjectSchema` are byte-unchanged, and no spec key, authorable spelling, stored row or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no old-to-new mapping to record. What changes is one runtime door converging on the existing contract: the schema registry now stores a code package's object with its own actions as their parse and refuses an object whose action does not parse. Every body it refuses was already off-contract, and refused by the authoring doors (`defineStack`, `os validate`, the metadata save door), before this change. The remedy is a correction of that body against the issues the refusal lists, not a conversion between two contract versions. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

The schema registry now parses an object's own `actions` through `ActionSchema` when a code package registers the object (`SchemaRegistry.registerObject`), and stores the parsed actions. A standalone `action` item has been stored this way already; both now go through one parse. Before this, an object that reached the registry without a parse kept its actions as authored. Examples are a raw plugin manifest, a `strict: false` stack, and a programmatic `registerApp`. Such an object was served with its actions unparsed: a declared `requiresFeature` (or `requiresMembershipReach`) was never lowered into `visible`, so the gate did nothing.

What the parse does to such an action, as with any parsed action:

- it lowers `requiresFeature` / `requiresMembershipReach` into `visible`;
- it fills schema defaults;
- it wraps a CEL string shorthand in `{ dialect, source }`.

An object a strict `defineStack` or `ObjectSchema.create` already parsed is stored unchanged. A registration with no package, and a tenant-authored body (the metadata save door's write-through, the boot rehydration of stored rows), is not judged here.

**BREAKING** for a package that registers an object whose own action `ActionSchema` does not accept.

- **Before.** The registry stored such an object as written, and served the action with any declared gate inert.
- **Now.** The object's registration is refused with `INVALID_METADATA` (422), and nothing of it is stored. The error names the action, its object and its package, and `issues[]` gives the path (`actions.N.KEY`) and message of each failure.
- **Fix.** Correct the action as `issues[]` describes. An object that passes `os validate`, or a strict `defineStack`, is unaffected.
