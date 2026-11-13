---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

fix(automation): a flow run's answer names the fields its write steps did not store, so a record button whose flow writes a read-only field no longer answers a plain success

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/spec`: `AutomationResult.droppedFields?: DroppedFieldsEvent[]`**, mirrored on `TriggerFlowResponseSchema.data.droppedFields` (the parity guard binds the two member for member). The element is the data engine's own `DroppedFieldsEventSchema` (`object`, `fields`, `reason`), so there is no new vocabulary. Set on a terminal success only, and only when a write step dropped a field; absent otherwise.
- **`@objectstack/service-automation`**: a `create_record` / `update_record` step whose caller-supplied values the engine legally stripped (a `readonly` field, a `readonlyWhen` lock, a computed field, …) already succeeded with a warning on its step; it now also carries the structured events, and the run's terminal answer folds them, one event per object and reason. A drop before a pause reaches the answer the resumed run gives, and a `subflow` child's drops ride up onto its parent's answer. The run's outcome does not change: `success`, `status` and `summary` read as before.

Every door that relays the run's answer carries it unchanged: an action of `type: 'flow'` (`POST /api/v1/actions/:object/:action`, `POST /api/v1/data/:object/:id/actions/:action`, the MCP `run_action` tool) and `POST /api/v1/automation/:name/trigger`. A caller that reads the answer can now tell the person who clicked that, for example, `status` did not take effect because it is read-only.
