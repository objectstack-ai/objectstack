---
'@objectstack/spec': minor
'@object-ui/types': minor
'@object-ui/core': minor
'@object-ui/app-shell': minor
---

feat(spec,console): a `type: 'flow'` action may declare `onSuccess`, and the console navigates after a run that completes

Clause-②: yes
Metadata-protocol: added

A flow action that creates a record could not take the user to it. `ActionSchema` refused `onSuccess` beside `type: 'flow'` (and the page action rows refused it beside a `flow` executor), so after the run the user stayed on the page they started from.

- **`@objectstack/spec`:** `onSuccess` is now accepted on a `type: 'flow'` action and beside a page action row's `flow` executor, next to `api` and `script`. On a flow action, `${result.*}` reads the completed run's answer (`AutomationResult`). Its `output` holds the flow's `isOutput` variables, so a `create_record` node that writes an `isOutput` variable `renewal` is reached as `${result.output.renewal.id}`. A variable the flow does not declare `isOutput: true` is not in `output`. The refusal text for `url`, `navigation`, `modal` and `form` now names the three executors. The Studio action form shows the `onSuccess` row for a flow action.
- **`@object-ui/types`:** `ActionResult` gains `handedOff`: the success is a hand-off to a follow-up surface, not a completion.
- **`@object-ui/app-shell`:** the flow launch judge marks a run that pauses at a screen, or ends refused, `handedOff`. A run that completes is not marked, including one whose toast is the flow's own `successMessage`.
- **`@object-ui/core`:** the action runner performs no `onSuccess` hop for a `handedOff` success. A flow run that pauses at a screen or ends refused does not navigate, neither when the screen or the refusal notice opens nor when the flow runner later finishes the run.

Example:

```ts
{
  name: 'start_renewal',
  type: 'flow',
  target: 'renewal_start',
  onSuccess: { navigate: '/apps/clm/clm_contract/record/${result.output.renewal.id}' },
}
```

with the flow declaring `variables: [{ name: 'renewal', type: 'object', isOutput: true }]` and its `create_record` node writing `outputVariable: 'renewal'`.
