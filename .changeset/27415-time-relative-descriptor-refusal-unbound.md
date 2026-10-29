---
'@objectstack/trigger-schedule': patch
---

fix(trigger-schedule): a time-relative flow whose `timeRelative` descriptor is refused now reads `bound: false` on the automation status, not `bound: true`

Clause-②: no
Metadata-protocol: none

`TimeRelativeTrigger.start` refused an invalid `config.timeRelative` descriptor (both `withinDays` and `offsetDays`, an unknown key, `schedule` nested inside the descriptor) by logging "not bound" and returning. The engine read that return as a successful bind, so `GET /api/v1/automation/_status` reported the flow as `bound: true` with no `unboundCause`, and no sweep ever ran.

The refusal now throws, the same way the trigger's organization and deployment-policy refusals already do. The engine records the flow as unbound: its status row reads `bound: false` with `unboundCause: 'binding_failure'`, and the boot-time binding audit lists it. The `warn` line the server logs is unchanged, and the thrown text is the same sentence. A re-bind with a broken descriptor also cancels the sweep an earlier valid bind armed.

Nothing changes for a valid descriptor. A host that calls `TimeRelativeTrigger.start` directly, outside the engine, should expect it to throw on a refused descriptor.
