---
"@objectstack/client": minor
"@objectstack/rest": patch
---

feat(client): close the 8 reports-family REST gaps (#3587 batch 2/5)

New `client.reports` namespace speaking the plugin-reports REST surface:
`list` / `save` / `get` / `delete` (schedules cascade), `run`, `schedule`,
`listSchedules`, `unschedule`. The two DELETE routes return 204 — the client
methods return `{ deleted: true }` without attempting to parse an empty body.
Fixed path (`/api/v1/reports` is not in `ApiRoutesSchema`), matching the
keys / share-links precedent. REST route-ledger ratchet: 34 → 26.
