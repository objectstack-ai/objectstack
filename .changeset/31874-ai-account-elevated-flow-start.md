---
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

fix(runtime, service-automation)!: an AI service account starts a flow that runs as the system only through an action its author opted into AI

Clause-②: no (narrowing) — an AI service account's start of a flow declared `runAs: 'system'` is refused with `403 PERMISSION_DENIED` at `POST /api/v1/automation/NAME/trigger` (and the legacy `POST /api/v1/automation/trigger/NAME`), at a declared endpoint of `type: 'flow'`, and at the REST actions route when the action that starts the flow does not declare `ai.exposed: true`; nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is converted: what moves is the answer an AI service account gets when it starts a flow that runs as the system, and opting an action into AI is an author's choice made by hand, not a mechanical conversion -->

**BREAKING** for a deployment whose AI service account (ADR-0151) starts a flow declared `runAs: 'system'` through the trigger route, through a declared `type: 'flow'` endpoint, or through the REST actions route on an action that does not declare `ai.exposed: true`.

- **The rule (ADR-0151 Non-goals).** A flow that runs as the system writes with the platform's authority, not the caller's. An AI service account starts one only through an action whose author opted it into AI: a `type: 'flow'` action that declares `ai: { exposed: true, description: … }`. It is the opt-in the MCP `run_action` tool already asks of every action, and no new key. One rule, asked by every door that starts a flow by name (`flowStartRefusal`): the trigger route and a declared endpoint start a flow with no action in hand, so nothing there carries the opt-in and the account is refused; the action door, behind REST and MCP alike, admits the account when the action carries it.
- **The answer.** `403 PERMISSION_DENIED`, the same words at every door: "An AI service account starts a flow that runs as the system only through an action its author opted into AI. Declare `ai: { exposed: true, description: … }` on an action of type 'flow' that targets the flow, and have the account run that action (the REST actions route or the MCP `run_action` tool)." Nothing is dispatched. It is checked after the refusal of an elevated self-triggered flow and before the flow's `requiredPermissions`, which still answers an admitted account.
- **The run keeps its kind.** The elevated run an admitted account starts carries `principalKind: 'agent'` on the facts of every data operation it makes, so a hook reading its session tells an agent-started elevated run from a person's. It is attribution: the run's own operations are authorized as the system, exactly as before.
- **Unchanged.** A person, an agent acting for a person over OAuth, and the system principal start the same flows as before. An account starts a flow that runs as the user (`runAs: 'user'`, the default) at every door as before, under its own grants. Flows that start on their own trigger (a record change, a schedule) are not judged.
- **Who moves, and the fix.** For each flow declared `runAs: 'system'` that an AI service account starts: declare an action of `type: 'flow'` whose `target` is the flow, with `ai: { exposed: true, description: … }` (or add that block to the action that already starts it), and have the account run the action, `POST /api/v1/actions/OBJECT/ACTION` or the MCP `run_action` tool, in place of the trigger route or the declared endpoint. A flow the account should run under its own grants declares `runAs: 'user'` instead and needs no action.
