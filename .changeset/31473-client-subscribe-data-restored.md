---
'@objectstack/client': patch
---

fix(client): `subscribeData` delivers `data.record.restored`, reading its event types from the spec

Clause-②: yes (widening) — `RealtimeAPI.subscribeData` now delivers every per-record event type the spec's `DataEventType` declares, which adds `data.record.restored` (a row restored from the recycle bin) to the created / updated / deleted it delivered before. `subscribeBulkData` reads `BulkDataEventType` the same way; its two types are unchanged.
Metadata-protocol: none

`subscribeData` asked for a hand-written list of created / updated / deleted, so when `data.record.restored` joined `DataEventType` the subscription filtered it out, and a subscriber's live list never saw a restored row come back. Both data subscriptions now take their event types from the spec enums (`DataEventType.options`, `BulkDataEventType.options`), so a type the spec adds later reaches subscribers without a client edit. A callback that switches on `event.type` will now also see `data.record.restored`, whose payload carries the restored row in `after`.
