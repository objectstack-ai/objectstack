---
"@objectstack/runtime": patch
---

**Behaviour change (security tightening):** the `/api/v1/automation` **definition writes** now require the `manage_metadata` capability (#10145).

`POST /api/v1/automation`, `PUT /api/v1/automation/:name` and `DELETE /api/v1/automation/:name` — `automation.create` / `automation.update` / `automation.delete` on the SDK — were reachable by **any authenticated caller**. They now answer **403 `PERMISSION_DENIED`** unless the caller holds `manage_metadata` (ADR-0066 D1's authoring capability), the same key the sibling `PUT /api/v1/meta/:type/:name` and every state-changing `/api/v1/packages/*` route already demand. Engine self-invocation (`isSystem`) bypasses, as on every other capability gate.

**Existing credentialed callers that author flows over HTTP will start getting 403** and must be granted `manage_metadata`. A flow is authored metadata: this closes the last write door onto the metadata plane that did not ask the metadata plane's question.

What was measured on a walled multi-organization deployment (`OS_TENANCY_POSTURE=isolated`): a plain tenant org owner holding `organization_admin` — the same session answered 403 by `PUT /meta/:type/:name`, `POST /ai/tools/:tool/execute` and `POST /packages/*` — created, modified and deleted flows through this door, all 200. Flow definitions are registered at **environment** scope, not organization scope, so the write crossed the tenant wall: a shipped flow deleted by one tenant read 404 for the actor, for an unrelated tenant **and** for the platform admin, and an injected flow read 200 for all three.

**Deliberately unchanged — execution is not authoring:**

- `POST /automation/:name/trigger` and the legacy `POST /automation/trigger/:name` **run** a flow. They keep their existing posture (authenticated, plus the flow's own `runAs` authorization envelope).
- `POST /automation/:name/runs/:runId/resume` is already fail-closed through the suspended node's `resumeAuthority`; a metadata capability in front of it would refuse the very user the flow paused for.
- `POST /automation/:name/toggle` mutates engine enablement rather than a definition, and is filed separately rather than folded into a security fix.
- The reads (`GET /automation`, `GET /automation/:name`, the run surfaces) are untouched; run-state reads keep their `sys_automation_run` grant.

The gate sits ahead of the service probe and ahead of body validation, so a refused caller neither writes anything nor learns from a 501-vs-403 whether the deployment mounts automation at all.
