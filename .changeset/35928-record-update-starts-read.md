---
'@objectstack/spec': minor
'@objectstack/service-automation': patch
'@objectstack/trigger-record-change': patch
'@objectstack/runtime': patch
'@objectstack/client': patch
---

feat(automation): `POST /api/v1/automation/_record-starts` answers which flows a proposed update of one record would start

Clause-②: yes (widening) — one new public read: the route `POST /api/v1/automation/_record-starts` (`automation.listRecordUpdateStarts` in the API contract and in `@objectstack/client`); `@objectstack/spec/api` adds `RecordUpdateStartsRequestSchema`, `RecordUpdateStartSchema`, `RecordUpdateStartsResponseSchema` and their types; `@objectstack/spec/contracts` adds `RecordUpdateStartsInput` and the optional `IAutomationService.listRecordUpdateStarts`; `@objectstack/spec/automation` adds `recordChangeTriggerHookEvents` and `recordChangeTriggerFiresOnUpdate`; `_record-starts` joins the `/automation` domain's reserved position literals. Nothing existing is removed or re-typed.
Metadata-protocol: added — the three new `@objectstack/spec/api` schemas enter the `api` authorable-surface shard (10 keys: `RecordUpdateStart:name/label/startsApproval`, `RecordUpdateStartsRequest:object/recordId/changes`, `RecordUpdateStartsResponse:success/data/error/meta`); no flow or other metadata key is added
Skills-docs: none — no skill under `skills/**` teaches the console's stage confirms; `content/docs/automation/flows.mdx` gains the read in this change.

The console's stage confirms now name the flows a move would start (objectstack#35928, ruling record 7073655354). They ask the server:

- **Request** `{ object, recordId, changes }`; **response** `{ success, data: { flows: [{ name, label, startsApproval }] } }`.
- **Who is answered:** a signed-in caller who can read the record. The record is read as the caller through the `/data` door's own `get`, so a record they cannot read answers `404 RECORD_NOT_FOUND` exactly as an absent one, and the engine is never asked. Anonymous `401`; a malformed body `400 VALIDATION_FAILED`; any query parameter `400 VALIDATION_ERROR`; an engine without the read `501`.
- **Which flows:** enabled `record_change` flows of the object, armed on their trigger, whose `triggerType` binds an update, and whose start condition holds for the record read with `changes` applied (`previous` is the record read). The condition goes through the engine's one start-condition gate, the one every run passes; the token grammar `@objectstack/trigger-record-change` binds hooks by moved into the spec (`recordChangeTriggerHookEvents`) so the preview reads the same rule, with no second copy. A condition that cannot be evaluated against the record is not listed. Hooks are never listed.
- **Per flow:** `name`, the authored `label` (a client translates it by name) and `startsApproval`, true for a flow holding an `approval` node (ADR-0019). No description, condition or nodes.
