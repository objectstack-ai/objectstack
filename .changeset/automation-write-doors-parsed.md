---
"@objectstack/spec": minor
"@objectstack/runtime": minor
"@objectstack/client": minor
"@objectstack/service-automation": minor
---

Automation write doors answer the canonicalized (parsed) flow (#12206, Option A — maintainer ruling 2026-08-26).

`POST /api/v1/automation` and `PUT /api/v1/automation/:name` now answer the canonicalized, parsed flow the engine stored — the same shape `GET /api/v1/automation/:name` already answers — instead of echoing the caller's own pre-parse request bytes. `IAutomationService.registerFlow` returns that `FlowParsed` (previously `void`), and the SDK's `client.automation.create` / `client.automation.update` bind `Promise<FlowParsed>` (previously deliberate `Promise<any>`). `CreateFlowResponseSchema` / `UpdateFlowResponseSchema` are now conformant with the real wire body, and `UpdateFlowRequestSchema.definition` requires the complete flow definition the engine actually requires (its former `.partial()` declared a partial-update capability nothing implements; a real partial update would be its own feature).

**Migration note (behaviour change on a published SDK surface).** A caller that read the write response back gets the canonicalized flow rather than its own bytes: schema defaults are materialized (`version`, `status`, `runAs`, per-edge `type` / `isDefault`), keys re-emit in schema order, and the PUT answer always carries `name`. The #12206 consumer survey measured zero non-test consumers of the old echo across objectstack and objectui. The one residual risk, named verbatim from that survey: "One real TYPE change — the only shape-breaking difference in the whole measurement": a string `edge.condition` becomes the lowered CEL envelope — the `edge.condition` string → `{dialect, source}` type change, zero measured consumers. A consumer doing `typeof edge.condition === 'string'` on the write response would break; per the survey no such consumer exists in either repo (the cloud repo was not measurable and is the declared gap). Implementers of `IAutomationService.registerFlow` must now return the stored parsed flow.
