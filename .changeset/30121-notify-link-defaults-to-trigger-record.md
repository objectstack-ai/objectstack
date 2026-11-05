---
'@objectstack/service-automation': minor
---

feat(service-automation): a record-triggered flow's notification opens the record that started the run, without the author writing `sourceObject` and `sourceId`

Clause-②: no — no accepted key, value or exported type changes; the node's existing `sourceObject` / `sourceId` / `actionUrl` keys keep their meaning when written.
Metadata-protocol: semantic

- **Before.** A `notify` node built its click-through link only from an explicit `sourceObject` + `sourceId` pair (or an `actionUrl`). The obvious record-triggered flow — `recipients`, `title`, `message` — passed `os validate` and sent a notification whose link was empty, so a click opened the notification list instead of the record.
- **Now.** A `notify` node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when the run has one: a record change (create or update), a time-relative sweep's row, or an action started on a record. The notification stores that record as its `source_object` / `source_id`, and the inbox opens `/OBJECT/ID`.
- **Unchanged.** An explicit pair or an explicit `actionUrl` wins, as before. A half-written pair is still dropped rather than defaulted. A run with no trigger record (a schedule, an inbound API post, a manual start with no record) links nowhere, as before. A delete event is not linked: its record is gone once the write lands.
- **To keep a notification unlinked** in a record-triggered flow, give it an `actionUrl` that points where it should go.
