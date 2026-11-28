---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
---

fix(lint)!: the publish gate refuses a subflow or map step that calls a flow the deployment does not hold

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (already-registered publish-refuses-flows-that-save-and-do-not-run) the same subflow-target rule at one more door; this change extends that entry's text from a CLI warning to an error at the runtime publish gate, judged against every flow the deployment holds -->

**BREAKING** accept-set narrowing, shipped as `minor`: an active publish of a flow whose `subflow` or `map` step names a flow that no part of the deployment holds was accepted before and is refused now (`422 INVALID_METADATA`, rule `flow-subflow-unknown`), with the fix named. The schema is unchanged, stored flows are not rewritten or refused at boot, and drafts are not gated.

A `subflow` or `map` step runs the flow its `config.flowName` names. When the engine holds no flow of that name, the step fails on every run (`Flow 'X' not found`). `flow-subflow-unknown` reported this only as a CLI warning, because the publish gate judged one flow at a time and could not tell a call to another stored flow from a call to a missing one.

- **The refusal.** On a flow publish the host now states the names of every flow the deployment holds: every installed package's flows (a disabled package's included), the stored flow rows in every state (a draft counts), the flows the same publish batch carries, and every flow the automation engine holds (a flow registered straight into the engine has no metadata row). A call naming none of them, and not the written flow itself, is an `error` at the publish gate.
- **No verdict.** When the host cannot read one of those sources (no automation service, a failed store read, said once at `warn`), or the set is empty, the gate does not judge the call.
- **Not judged.** Whether the engine's package-scoped name resolution (ADR-0150 D3) lets the calling flow reach the called one: the set is the whole deployment, never narrowed to the written package's dependency closure.
- **The CLI.** `os validate` / `lint` / `compile` / `build` still report `flow-subflow-unknown` as a warning: the stack is one app, and another installed package may ship the called flow.
- **Exports.** `validateFlowSubflowTargets` takes an optional second argument (`FlowSubflowTargetOptions`, `deploymentFlowNames`); `AuthoringRuleContext` gains `deploymentFlowNames`; `runRuntimeAuthoringRules` and `evaluateRuntimeAuthoringGate` take an optional `deploymentFlowNames`. All optional; an omitted value keeps the earlier behaviour.

FROM → TO:

- `{ type: 'subflow', config: { flowName: 'notfy_owner' } }` (no such flow) → `{ type: 'subflow', config: { flowName: 'notify_owner' } }`

One-line fix: name a flow the deployment holds, or save the called flow first (a draft is enough) and publish the caller after it.
