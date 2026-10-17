---
'@objectstack/service-automation': minor
---

feat(automation): `getFlowRuntimeStates()` stamps `unboundCause` beside `reason`

Clause-②: yes (widening)

Each branch that decides why an enabled, triggered flow is not armed now answers its closed `FlowUnboundCause` together with its sentence: `deployment_policy`, `disabled_subflow`, `missing_trigger` or `binding_failure`. `GET /automation/_status` passes the rows through unchanged, so the field reaches the console with no route change. Bound, disabled and trigger-less rows carry neither `reason` nor `unboundCause`. The sentences and `getTriggerBindingAudit()` are unchanged.
