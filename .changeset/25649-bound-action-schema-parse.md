---
'@objectstack/objectql': patch
---

fix(objectql)!: a code package's action is stored as its `ActionSchema` parse, so `requiresFeature` takes effect on bound actions

Clause-②: no (narrowing) — `SchemaRegistry.registerItem`, and with it `ObjectQL.registerApp` and every door that registers a code package's items, now refuses with `422 INVALID_METADATA` an `action` body that does not satisfy `ActionSchema`. Before, it registered that body as written. Nothing is widened.

Metadata-protocol: none (`ActionSchema` is unchanged and no key is added, retired or re-shaped; every body the registry now refuses already fails the same schema at `defineStack`, `os validate` and the metadata save door)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: `ActionSchema` is byte-unchanged, and no spec key, authorable spelling, stored row or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no old-to-new mapping to record. What changes is one runtime door converging on the existing contract: the schema registry now stores a code package's action as its parse and refuses one that does not parse. Every body it refuses was already off-contract, and refused by the authoring doors, before this change. The remedy is a correction of that body against the issues the refusal lists, not a conversion between two contract versions. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

The schema registry now parses every `action` item a code package registers through `ActionSchema` before storing it. The stored item is the parsed body. Before this, an action that reached the registry without a parse was stored as authored. Examples are a programmatic `registerApp`, a nested plugin's manifest, a `strict: false` stack, and a raw plugin manifest. Such an action was then attached to its target object unparsed. Its `requiresFeature` (and `requiresMembershipReach`) was never lowered into `visible`, so the declared gate did nothing. A platform object's own actions were already lowered.

What the parse does to such an action, as with any parsed action:

- it lowers `requiresFeature` / `requiresMembershipReach` into `visible`;
- it fills schema defaults;
- it wraps a CEL string shorthand in `{ dialect, source }`.

An action a strict `defineStack` already parsed is stored unchanged.

**BREAKING** for a package that registers an action body `ActionSchema` does not accept.

- **Before.** The registry stored such a body as written, and served it with any declared gate inert.
- **Now.** Registration is refused with `INVALID_METADATA` (422). The error names the action and its package, and `issues[]` gives the path and message of each failure. The registration that carried it fails.
- **Fix.** Correct the action as `issues[]` describes. An action that passes `os validate`, or a strict `defineStack`, is unaffected.
