---
'@objectstack/runtime': patch
---

fix(runtime): the legacy `POST /automation/trigger/…` is no route past three segments

Clause-②: no
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is what an unserved `/automation/trigger/…` path answers; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The legacy run door serves two shapes: `POST /api/v1/automation/trigger/:name` (bare) and `POST /api/v1/automation/trigger/:ns/:name` (addressed, ADR-0150 D5). Any deeper `POST` under `/automation/trigger/` is now declined as an unserved shape, the way `/actions` declines a path past its arity. Other verbs at any depth are unchanged: they belong to a flow named `trigger` (for example `GET /automation/trigger/runs/:runId`).

**BREAKING**, one answer (first-party count: 0; the SDK's `client.automation.trigger()` sends `trigger/:name`, and no first-party client, CLI or Console code sends the legacy door past two segments):

- **A `POST /automation/trigger/…` path of four or more segments** runs nothing. On the catch-all host (`createHonoApp`) the domain ran the flow named by the segment after `trigger` and ignored the rest; now the host answers its own `404`. On the mounted host (the dispatcher plugin on the standalone server) the same happened for each deep `POST` mount such a path matches by its parameters (for example `POST /automation/trigger/runs/:runId/cancel` ran the flow `runs`, and `POST /automation/trigger/:ns/runs/:runId/resume` ran the flow `:ns`); now the dispatcher answers its no-route `404 ROUTE_NOT_FOUND`. Any other deep path stays the transport's `404`, as before.

The fix: FROM `POST /automation/trigger/:name/…` TO `POST /automation/trigger/:name` (bare) or `POST /automation/trigger/<namespace>/:name` (addressed), with nothing after the name.
