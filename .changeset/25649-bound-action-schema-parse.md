---
'@objectstack/objectql': patch
---

fix(objectql): a code package's action is stored as its `ActionSchema` parse, so `requiresFeature` takes effect on bound actions

Clause-②: no
Metadata-protocol: none

The schema registry now parses every `action` item a code package registers through `ActionSchema` before storing it. The stored item is the parsed body. Before this, an action that reached the registry without a parse was stored as authored. Examples are a programmatic `registerApp`, a nested plugin's manifest, a `strict: false` stack, and a raw plugin manifest. Such an action was then attached to its target object unparsed. Its `requiresFeature` (and `requiresMembershipReach`) was never lowered into `visible`, so the declared gate did nothing. A platform object's own actions were already lowered.

What the parse does to such an action, as with any parsed action:

- it lowers `requiresFeature` / `requiresMembershipReach` into `visible`;
- it fills schema defaults;
- it wraps a CEL string shorthand in `{ dialect, source }`.

An action a strict `defineStack` already parsed is stored unchanged.

An action that does not satisfy `ActionSchema` is now refused at registration with `INVALID_METADATA` (422). The error names the action and its package, and `issues[]` locates each failure. Before, such an action was registered silently. `defineStack` and `os validate` already refuse the same declaration.

What to do: nothing, if your actions pass `os validate`. If a package registers raw action objects, run them through `defineAction` (or `os validate`) and correct what it reports.
