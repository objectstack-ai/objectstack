---
"@objectstack/plugin-reports": patch
"@objectstack/connector-openapi": patch
"@objectstack/connector-rest": patch
"@objectstack/connector-slack": patch
"@objectstack/plugin-approvals": patch
"@objectstack/service-knowledge": patch
---

Release these plugins' resources from `destroy()`, the teardown hook the kernel
actually calls (#10371). `Plugin` declares `init()`, `start?(ctx)` and
`destroy?()` — and no `stop()` — so `ObjectKernel.performShutdown()` and
`LiteKernel.destroy()`, which walk the plugins in reverse calling
`plugin.destroy()`, walked straight past every plugin whose teardown was spelled
`stop()`. `await kernel.shutdown()` resolved with the reports dispatcher still
armed, the REST/OpenAPI/Slack connectors still registered on the automation
engine, the approvals SLA escalation job still scheduled, and the knowledge
event-sync subscription still open.

Each teardown body now lives in `destroy()`. `stop()` is retained as a
delegating alias with its parameter made optional, so an embedder that learned
to call it directly — precisely because the kernel never did — keeps working
unchanged. No export is removed and the `Plugin` interface is untouched.

Same defect as #9371 in `@objectstack/service-messaging`, which surfaced as
fully green test runs exiting 1 on `EnvironmentTeardownError` and being evicted
from the merge queue.
