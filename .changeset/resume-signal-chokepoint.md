---
"@objectstack/spec": minor
"@objectstack/service-automation": patch
"@objectstack/runtime": patch
---

fix(automation): one chokepoint for the resume signal — `output` reopened the hole `inputs` had just closed (#3879)

#3853 guarded `signal.variables` at the route. That closed one of **two**
equivalent paths into the same variable map and left the other open:
`signal.output` keys are merged under `${run.nodeId}.${key}`, and for a run
parked on a `map` node `run.nodeId` **is** the map node — so

```jsonc
{ "output": { "$mapItemDone": true, "$mapItemOutput": { "result": "FORGED" } } }
```

writes exactly the `<mapNodeId>.$mapItemDone` the `inputs` guard had refused,
making the map record a result for an item nobody decided. Demonstrated with a
repro, then fixed.

Scope: the #3853 map gate still held, so a batch whose pending item sits on an
`approval` was refused before any of this — the **approval bypass stayed
closed**. The residual was forging the recorded result of an item on an
*ungated* pause.

Two escapes with one shape is a design signal, not two bugs, so the fix is
structural rather than a third patch:

- **`applyResumeSignal` is the one place a resume signal reaches the variable
  map.** Both fields are collected into a single write list (already in final,
  prefixed form), checked, then applied — a new signal field is covered by
  construction rather than by remembering.
- **All-or-nothing**, and checked *before* the suspension is consumed: a
  rejected signal applies nothing (not even legitimate keys sent alongside) and
  the run stays parked, so the real continuation still lands.
- **The engine owns the rule; the transport maps the verdict.** `resume` returns
  `{ success: false, code: 'invalid_signal' }`; the route answers **400**. The
  SDK and any future adapter inherit it — implemented in one transport it
  protected exactly one transport, and one field of it.
- Engine-built signals (the subflow output mapping, the map item handoff) are
  exempt via a module-private symbol. Deliberately *not*
  `RESUME_AUTHORITY_SERVICE`: that marker means "the owning service authorized
  this decision", and a service still has no business writing engine internals.

`AutomationResult.code` gains `'invalid_signal'` alongside `'forbidden'` — a
`switch` over it needs a new arm; a plain read does not.

Nothing changes for authoring: ordinary variables pass, `$` mid-name (`price$`)
and dotted names (`collect.note`) included. Only names the engine reserves —
`$…` or a `.$` segment — are refused.
