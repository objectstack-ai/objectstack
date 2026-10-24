---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat: a package's action can launch a flow, and its dashboard widget can bind a dataset, that another package of the same release artifact ships

Clause-②: yes (widening)
Metadata-protocol: added

One release artifact carries several packages (ADR-0130 D4). Two per-package checks judged a reference against one package and refused a target a sibling package provides. The artifact carries the target, and the runtime serves it.

- **`@objectstack/spec`: `defineStack(config, { artifactFlows })`.** This new `DefineStackOptions` key lists flow names that the other packages of the artifact provide. A `type: 'flow'` action's `target` resolves against the stack's own `flows` plus these names. That covers a top-level action, an action authored on an object, and an inline page action. It works the way `artifactObjects` already does for permission grants and seed rows.
  - The option widens a check that already runs. A stack that declares no flows of its own still leaves its flow targets unresolved (a plugin may serve them).
  - `defineStack` records every target that resolved only through the list, as a non-enumerable mark on the stack it returns. `composeStacks` refuses the composition when no input defines that flow. The refusal uses the same `STACK_CROSS_REFERENCE_INVALID` envelope and the same per-finding message as the per-stack pass. An input that did not opt in cannot newly fail at composition.
  - A flow that no package of the artifact defines is refused, as before.
- **`@objectstack/lint`: `widget-dataset-unknown`.** The rule resolves a widget's `dataset` against the datasets that every `packages[]` body declares, as well as the stack's own. This is the resolution context that `os build`, `os validate` and `os lint` already pass to each package's run. Dataset-level checks still judge only the package's own datasets. A dataset that no package declares is refused, as before. The runtime publish gate passes no `packages[]`, so its behaviour is unchanged.

Fix for a module split such as HotCRM's: in the app package, write `defineStack(appConfig, { artifactFlows: revenue.flows?.map((f) => f.name) })` and compose both packages with `composeStacks([...], { manifest: 'preserve' })`. A cross-package dataset binding needs no change.
