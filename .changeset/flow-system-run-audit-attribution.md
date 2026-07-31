---
"@objectstack/spec": patch
"@objectstack/service-automation": patch
"@objectstack/objectql": patch
---

fix(automation,objectql,spec): attribute `runAs:'system'` flow writes to the flow in the audit log (#4366)

A `runAs:'system'` flow's data writes carried no attribution at all: the run
context resolved to `{ isSystem: true }` with no `userId` and no service
principal, so the audit writer recorded `user_id=null, actor=null` and the
record-history UI rendered every such row as "Unknown user" — business users
read the flow's own status mirror as data corruption.

The `svc:*` attribution channel (ADR-0014 D2, `ExecutionContext.actor`) already
existed for exactly this class of writer; it was simply never wired end-to-end:

- **service-automation** — `resolveRunContext` now stamps `flowName` alongside
  `runAs`/`flowRunId`, and `resolveRunDataContext` labels a `runAs:'system'`
  run's data context `actor: 'svc:flow:<flowName>'` (fallback
  `svc:flow:automation`). Attribution only — no security middleware keys on it.
- **objectql** — `buildSession` propagates `ExecutionContext.actor` onto the
  hook session, closing the gap that left the audit writer's
  `userId ?? session.actor` fallback unreachable from the engine path.
- **spec** — `AutomationContext.flowName` (engine-stamped, provenance) and the
  hook session's optional `actor` field document the contract.

No behavior change for user-attributed writes: `userId` still wins wherever it
is present.
