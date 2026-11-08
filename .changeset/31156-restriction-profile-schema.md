---
'@objectstack/spec': minor
---

feat(spec): `RestrictionProfileSchema` — the closed shape of what a target environment does not let metadata do, published by that environment

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — the profile is data a target environment publishes, not a key an app author writes into a stack, and no reader ships in this release; authors meet it through `os validate --target`, whose refusals will name each rule.

`@objectstack/spec/system` exports `RestrictionProfileSchema` and its `RestrictionProfile` type. One source of metadata-authoring knowledge serves every build channel, and a hosted environment differs from a local one only by a restriction profile. This is that profile's shape:

- `allowCode` (boolean): whether metadata that carries code is allowed — object lifecycle hooks, named handler functions, code plugins.
- `allowScheduledAutomation` (boolean): whether flows of `type: 'schedule'` and scheduled background jobs are allowed.
- `allowedFlowNodeTypes`: the built-in flow node types a flow may use. Its items are `FlowNodeAction` ids, read from the spec's own node registry, so a type the registry does not name is refused and there is no second list to keep in step.
- `versions: { spec, skills }`: the `@objectstack/spec` and `@objectstack/skills` versions the environment runs, each an exact SemVer 2.0.0 version.

The shape is strict at both levels and every key is required. **An absent profile means no restriction** (the local / open default): an environment with no restriction publishes no profile, and `{}` is refused rather than read as "everything allowed". The schema is data only: nothing in `@objectstack/spec` enforces it.
