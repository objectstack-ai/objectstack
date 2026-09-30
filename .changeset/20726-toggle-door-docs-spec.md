---
'@objectstack/spec': patch
---

docs(spec): the Automation API docblock says the toggle door switches packaged flows only, and names a customer flow's switch (#20726)

The module docblock of `api/automation-api.zod.ts` listed `POST /api/v1/automation/:name/toggle` as "Enable/disable flow". That file ships as source, and its docblock is also the source of the Automation API reference page. The line now reads "Enable/disable a packaged flow". A new paragraph says what a flow authored in the deployment uses instead: its `status`, published with the complete definition through `PUT /api/v1/automation/:name`. The toggle door refuses such a flow with 409 `RESOURCE_CONFLICT`. The `IAutomationService.toggleFlow` docblock, which read "Enable or disable a flow", says the same. This is prose only: no schema, type or export changes.
