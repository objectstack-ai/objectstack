---
'@objectstack/spec': minor
---

feat(spec): `FlowRuntimeState` gains `unboundCause`, a closed classifier beside `reason`

Clause-②: yes (widening)

`FlowRuntimeState.reason` is a sentence a consumer renders and must not parse, so until now a console could not tell a flow left unarmed by deployment policy from one whose binding is broken: both arrive as `enabled: true, bound: false` with a `reason`. The row now also carries an optional `unboundCause`, present on exactly the rows that carry `reason` and absent on every other row.

Its values are published as `FLOW_UNBOUND_CAUSES` (`@objectstack/spec/contracts`), with the derived type `FlowUnboundCause`:

- `deployment_policy`: package-authored scheduled work is switched off on this deployment. An operator remedy, not a defect.
- `disabled_subflow`: the flow calls a packaged subflow that is disabled (ADR-0126 §7.3). Enable the subflow and the caller arms.
- `missing_trigger`: no trigger of the declared type is registered. Depend on the trigger package (`requires: ['triggers']`).
- `binding_failure`: the trigger is registered but binding the flow to it failed. The earlier boot warnings name the error.

Additive: existing producers and consumers keep working unchanged, and `reason` keeps its text.
