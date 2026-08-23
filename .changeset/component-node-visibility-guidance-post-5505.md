---
"@objectstack/spec": patch
---

fix(spec): `COMPONENT_NODE_VISIBILITY_GUIDANCE` no longer claims a hoisted `properties` visibility key is evaluated by nothing (#11033)

The `COMPONENT_NODE_VISIBILITY_KEYS` key-set guard's `prescription` — the text
emitted to an author when a visibility key (`visible` / `visibleWhen` / …) is
written inside `properties` instead of on the component node — closed with:

> Inside `properties` it is hoisted onto the node by the renderer but evaluated
> by nothing — the component renders unconditionally, which is a visibility
> gate that silently does not gate.

That was true when it was written and is false since objectui#5505
(`c86185eb5`, merged 2026-08-21): `SchemaRenderer`'s node-level `visibleWhen`
evaluator now binds `record`, so the hoisted value IS evaluated by the
node-level gate. Post-#5505 the props-level and node-level forms evaluate the
same value over the same `RecordContext` and compose as an idempotent AND —
there is no gate that silently fails to gate.

The prescription now states that truth instead, and keeps its move-it-up
advice resting on the reason that still holds: `visibleWhen` at the node,
beside `type` and `id`, is the ADR-0089 canonical spelling — a layer-discipline
argument, not an inertness one.

Message text only. No accept/reject verdict changes, no schema shape changes,
and no runtime behaviour changes — both gates already evaluated the value
identically before and after this change.
