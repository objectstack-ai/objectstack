---
'@object-ui/plugin-detail': patch
---

feat(record page): the timeline's Changes chip is offered only while the record shows its field history

Clause-②: no
Metadata-protocol: none

- **`@object-ui/plugin-detail`: `RecordFieldHistoryContext`.** A host tells the record page's timeline stream whether it shows the record's field history; while it says `false`, the stream draws the All / Activity / Discussion chips and no Changes chip, and a stream left on Changes goes back to All. With no provider every chip draws, as before. `RecordActivityTimeline` takes the chips to offer as `streamFilters` (all four when absent).
- **The Console's record page** hands over its `enable.trackHistory` gate, so an object that does not opt in no longer offers a Changes chip on its timeline tab.
- **The CRM example** opens `enable.trackHistory` on `crm_lead`, `crm_account`, `crm_contact` and `crm_opportunity`, so their record pages show each field change with its before and after values. The flag stays opt-in for every other object.
