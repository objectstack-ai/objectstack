---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/plugin-security': patch
'@objectstack/service-automation': patch
---

feat(automation): `IAutomationService.dryRun` runs an unpublished flow definition once, unarmed, as a named user

Clause-②: yes (widening) — `AutomationEngine.dryRun` admits a `runAs: 'system'` self-triggered draft for the named user (ruling B); `@objectstack/core` exports the shared flow-start rules (`aiAccountElevatedStartRefusal`, `requiredPermissionsStartRefusal`, `requiredPermissionsRefusal`, `missingCapabilities`, `isAiServiceAccount`, `AI_ACCOUNT_ELEVATED_START_REFUSAL`, `FlowStartPermissionRefusal`); plugin-security's registered `security` service serves `canWriteObject`
Metadata-protocol: none

The automation service now implements `dryRun(definition, { userId, record, … })`, the method the `IAutomationService` contract declares. A dry run admits the definition by the checks `registerFlow` asks, then by the rules that admit a start by name, and then runs it once against the supplied record as the named user. It registers nothing and arms no trigger, and it writes, sends and pauses nothing:

- Record writes (`create_record`, `update_record`, `delete_record`) are simulated. The step shows the values the run would write and a placeholder id for a new record. The named user's object-level write permission is judged as allowed, refused or not judged. A later read by id in the same run sees the simulated row.
- Routing and computing nodes (`assignment`, `decision`, gateways, loops, parallel branches, try/catch) run on the engine's own executors. A decision step shows the branch taken and the expressions it evaluated.
- Outbound nodes (`http`, email and the like) are never executed. The step shows the payload they would send.
- The run stops at a node that pauses (`approval`, `wait`, `screen`, a subflow) and names why. A node type the dry run cannot simulate stops it as `not_simulated`.

Under maintainer ruling B (record 6917953931), a draft declaring `runAs: 'system'` whose type starts on its own trigger is admitted to a dry run for the named user, and the run is never elevated. The contract's admission text says so. A by-name start of a published flow keeps refusing such a flow.

The AI service account rule and the flow's own `requiredPermissions` rule now live in `@objectstack/core`. The by-name start doors and the dry run both ask that one copy. `@objectstack/runtime` re-exports every symbol under the name it had. The registered `security` service now also exposes `canWriteObject`, so a dry run can judge a write without performing it.
