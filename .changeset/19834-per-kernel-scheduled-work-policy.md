---
'@objectstack/service-automation': minor
'@objectstack/trigger-schedule': minor
---

A kernel can now carry its own scheduled-work policy. `AutomationEngineOptions`, `AutomationServicePluginOptions` (forwarded to the engine), `ScheduleTriggerPlugin` and `TimeRelativeTriggerPlugin` accept an optional `scheduledWorkPolicy`: a `ScheduledWorkPolicy` value, or a resolver called at each bind. When it is present, the engine's bind gate and each trigger's own gate read it instead of the deployment resolver. When it is absent, they call the zero-argument `resolveScheduledWorkPolicy()` exactly as before.

It exists for a host that runs several kernels of different plans in one process. `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` is one reading for the whole process, so such a host could not turn scheduled work off for one kernel and leave it on for the kernel beside it:

```ts
const policy = { enabled: false, posture: 'single', requiresActingOrganization: false, runOwnership: 'unscoped' } as const;
kernel.use(new AutomationServicePlugin({ scheduledWorkPolicy: policy }));
kernel.use(new ScheduleTriggerPlugin({ scheduledWorkPolicy: policy }));
kernel.use(new TimeRelativeTriggerPlugin({ scheduledWorkPolicy: policy }));
```

Give all three the same policy. The engine gates first, and each trigger keeps its own gate for hosts that drive it without the engine. If a trigger reads a different answer from its engine, the engine's audit reports that trigger's refusal as a binding failure. A hand-built value must keep the resolver's invariant, `requiresActingOrganization === (enabled && runOwnership === 'declared')`.

A time-triggered flow that the per-kernel policy leaves unarmed is reported the same way as one the deployment leaves unarmed. `getTriggerBindingAudit()` and the `getFlowRuntimeStates()` row both give `SCHEDULED_WORK_DISABLED_REASON`, never a binding failure and never "add `requires: ['triggers']`". `ScheduleTrigger` and `TimeRelativeTrigger` also accept the same option in a new trailing constructor argument. The types `ScheduleTriggerPluginOptions`, `TimeRelativeTriggerPluginOptions`, `ScheduledWorkTriggerOptions` and `ScheduledWorkPolicySource` are exported from `@objectstack/trigger-schedule`.

Nothing changes for a host that passes no policy. The deployment default keeps its meaning and its spelling, and `objectstack serve` is unchanged. This change only adds options, so there is nothing to migrate.

Clause-②: no
