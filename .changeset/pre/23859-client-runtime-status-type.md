---
'@objectstack/client': patch
---

Clause-②: no

fix(client): `client.automation.getRuntimeStatus()` types its rows as the declared contract `FlowRuntimeState` (#23859)

**What was wrong.** The method declared its answer as `{ flows: Array<{ name, enabled, bound }>; total }`. `GET /automation/_status` serves the automation engine's `getFlowRuntimeStates()` rows unchanged, and each row is the contract `FlowRuntimeState` from `@objectstack/spec/contracts`. The SDK's type therefore hid five optional fields the wire already carries: `status`, `triggerType`, `object`, `reason` (one sentence saying why an enabled, triggered flow is not armed) and `unboundCause` (which of the closed `FLOW_UNBOUND_CAUSES` that sentence describes). A caller that read `row.reason` or `row.unboundCause` got a type error and either cast past it or concluded the field did not exist.

**What changes.** The return type is now `Promise<{ flows: FlowRuntimeState[]; total: number }>`. `name`, `enabled` and `bound` stay required, so existing callers compile unchanged. Read `row.unboundCause` to classify an unarmed flow, and render `row.reason` without parsing it. The request, the route and the values on the wire are unchanged.
