---
"@objectstack/service-automation": patch
"@objectstack/objectql": patch
---

Arm a deterministic flow when a runtime-authored flow reuses a packaged flow's name

A runtime-authored flow that reused a packaged flow's name silently replaced it,
and which of the two ended up armed depended on registration order. The metadata
registry keys items `packageId:name` and deliberately coexists both (ADR-0048
§3.4), `listItems('flow')` returns both with no precedence, and the automation
engine keys flows by bare name — so the boot pull registered both under one key
and Map iteration order picked the survivor. Measured: registering the package
first armed the runtime flow, registering the runtime row first armed the
packaged flow, with no warning and no way to tell which had won.

The boot pull now collapses same-named definitions before anything is armed,
applying the ADR-0005 overlay precedence ADR-0048 §3.4 routes this case to: the
runtime/DB overlay wins over the packaged artifact, which is the sanctioned
override path. Two packages shipping one bare name resolve by package id, so
boot order no longer decides anything.

Collisions are no longer silent. The pull warns once per colliding name — naming
the name, every contender, and which one is armed — and repeats it at bootstrap
beside the other automation audits. `getShadowedFlows()` is a new receipt listing
each contested name with its armed and shadowed definitions, and
`getFlowRuntimeStates()` rows now carry `armedFrom`/`shadowed` for contested
names; previously the displaced definition was invisible by construction, since
the flow map holds one entry per name. The `Pulled N flow(s)` line now counts
distinct names rather than registrations.

`isCodeArtifactBody` is exported from `@objectstack/objectql` so consumers that
collapse same-named metadata answer "does a code package ship this?" with the
registry's own test instead of re-deriving it from `_packageId`.
