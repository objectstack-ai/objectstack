---
'@objectstack/spec': patch
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
---

fix(runtime): a flow started through the REST or action door carries its caller's posture rung beside their positions and permission sets, so a platform administrator's manual run is served the ledger's deployment-level rows their request is served (#28099)

Clause-②: yes (widening) — `AutomationContext` (`@objectstack/spec/contracts`) gains one optional member, `posture` (typed `ExecutionContext['posture']`); the REST trigger door and the action door fill it from the request's resolved execution context, and a run carrying it is served what that rung admits.
Metadata-protocol: none

A request carries the posture rung its user resolves to (`ExecutionContext.posture`, ADR-0095 D2/D3). Since #28070 a `runAs: 'user'` run whose grants the engine resolves (a record-change run, the segment after an approval decision) carries that rung too. A run started through a door did not: the trigger door (`buildAutomationContext`, `POST /api/v1/automation/:name/trigger`, the legacy trigger route and a declared `type: 'flow'` endpoint) and the action door (`dispatchFlowAction`, REST `/actions` and MCP `run_action`) forward the caller's positions and permission sets, so run setup does not re-resolve them, and they dropped the rung. A platform administrator's manually-run flow was then served the organization's ledger rows only. That failed closed (fewer rows, never more).

- **Now.** Both doors copy the request's own `ec.posture` onto the run context, as they copy its positions, permission sets, organization and locale. Run setup keeps it beside the forwarded grants and does not re-derive it, and every data node carries it to the data engine. The platform administrator's door-started run is served the deployment-level rows, as their request is.
- **The caller's own rung, as-is.** It is read off the execution context only (a request body key named `posture` stays a flow param), never derived from the flow's author, never raised, and never filled in when the request carries none: such a run carries no rung, as before.
- **Only beside the grants it came from.** A door forwards positions and permission sets only when they are non-empty, so a rung can arrive without them. Run setup then resolves the grants itself and takes the rung off that same resolution, dropping the forwarded one (or carrying none when the resolution has none).
- **Unchanged.** A run whose grants the engine resolves (#28070), the approval decision switch, and a `runAs: 'system'` run.
