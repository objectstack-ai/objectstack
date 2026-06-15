---
"@objectstack/service-automation": minor
"@objectstack/cli": patch
---

feat(automation): resolve & validate `script`-node callables; first-class function registration (#1870)

A flow `script` node that pointed at an unregistered callable (or declared no
`actionType`/`function` at all) built fine and silently did nothing at runtime.
Two changes close that gap:

- **Loud runtime resolution.** The built-in `script` executor now resolves its
  target in order — built-in side-effect (`email`/`slack`) → a registered
  function (`config.function`, or a bare `config.actionType` that matches no
  built-in) → otherwise **fail the step loudly**. The old `(no-op handler)`
  success path is gone, so an unwired callable can no longer quietly skip.
- **First-class registration path.** `AutomationEngine.setFunctionResolver()` /
  `resolveFunction()` bridge flow nodes to the host function registry. The
  automation plugin wires it to ObjectQL's `resolveFunction` (populated from
  `bundle.functions` / `defineStack({ functions })`), so an authored package can
  register a function and call it from a `script` node:
  `{ type: 'script', config: { function: 'my_fn', inputs: { … } } }`.
- **Build-time structural check.** `objectstack build` now flags a `script` node
  that declares neither `actionType` nor `function` (the `actionType: undefined`
  repro). Function *existence* is verified at runtime — functions are code, not
  serialized into the artifact.
