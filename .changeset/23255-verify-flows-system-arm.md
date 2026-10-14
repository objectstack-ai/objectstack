---
'@objectstack/verify': minor
---

feat(verify): `flows.run` takes the system principal, `{ system: true }`, and starts the flow the way its own trigger does

Clause-②: yes

`flows.run(name, params, { system: true })` is a new overload beside `flows.run(name, params, { as })`. Nothing is removed, and the `{ as }` overload answers as before.

- **What it does.** It calls the booted `automation` service's own `execute(name, { params, callerParamKeys: [] })`, in process. That is the call the schedule trigger's tick makes when it fires a flow. No HTTP route is involved, and no caller is resolved, admitted or refused. The engine applies the flow's own `runAs`, as it does for a run its trigger fired.
- **Why.** The trigger route, `POST /automation/:name/trigger`, refuses a self-triggered flow declared `runAs: 'system'` (`type` `autolaunched`, `record_change` or `schedule`) to every caller, the platform admin included, with `PERMISSION_DENIED` / `403`. That refusal is unchanged. So an app had no kit door to start its own scheduled flow in a test, and had to call the automation service by hand.
- **What it answers.** The same `FlowRun` the `{ as }` overload answers: the engine's result unchanged, plus `flowName`. A run that paused goes straight back to `flows.resume`. The engine answers a run that did not succeed with a result, not a throw, and this overload hands that result back unchanged: `success: false`, with `status: 'failed'` for a run that failed, a `code` for a refusal before dispatch (such as `FLOW_DISABLED`), and no `code` for an unknown flow name. Assert on `success` before asserting on the flow's side effects.
- **What the context leaves out.** `params` are the trigger's seeds: like the tick, the context names no caller-supplied keys, so a `screen` node takes none of them as its submission. The context carries no `event`, no user and no organization. A schedule binding that declares an acting organization runs as that organization on a real tick; this overload does not read the binding.
- **One caller.** A call that names both `as` and `system: true` is refused with `INVALID_REQUEST` / `400` before anything runs, as `hooks.run` refuses it.

```ts
const run = await stack.flows.run('case_sla_monitor', {}, { system: true });
expect(run.success).toBe(true);

// The trigger door still refuses a person, the admin included.
await expect(stack.flows.run('case_sla_monitor', {}, { as: admin }))
  .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
```
