---
"@objectstack/runtime": patch
---

fix(actions): seed a flow action's params with the row id, like the trigger route does (#3915 follow-up)

#3915 gave the REST `/actions/:object/:action` route its flow dispatch and
documented it as "equivalent to `POST /api/v1/automation/:target/trigger`,
without having to know the flow name". A real run showed that claim did not
hold: the params bag carried the subject record's fields — so `id` — but never
`recordId`. The CRM's own `crm_convert_lead` action declares
`recordIdParam: 'recordId'` and its flow reads `{recordId}`, so invoking it
through the actions endpoint reached the automation engine and then died at its
first node:

```
Flow 'crm_convert_lead_wizard' failed: Node 'get_lead' failed: get_record:
refusing to run — 1 filter condition(s) resolved to nothing … `{recordId}` (at id)
```

while the identical run through `/automation/crm_convert_lead_wizard/trigger`
paused normally on its first screen. Only a live invocation surfaced it — the
unit tests mock `automation.execute`, so they pinned the call shape without
noticing the bag was missing the key flows actually read.

`dispatchFlowAction` now seeds the row id under the same keys
`domains/automation.ts` seeds for the trigger route — `recordId` and the
`<objectName>Id` camelCase alias — plus the action's own declared
`recordIdParam` (sourced from `recordIdField`, default `id`) when it names a
third key. Explicit action params still win over every seed, and the seeding
applies to the MCP `run_action` path too, which shared the same gap. A declared
`recordIdParam` that no dispatcher honoured was the `declared ≠ enforced` shape
in miniature.
