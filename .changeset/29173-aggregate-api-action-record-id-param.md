---
'@objectstack/runtime': patch
---

fix(runtime): a record-less `execution: 'aggregate'` api action that declares `recordIdParam` is forwarded to its target instead of refused 400

Clause-②: no
Metadata-protocol: none

A bulk action declared `type: 'api'`, `execution: 'aggregate'` and `recordIdParam` runs once for the whole selection: the console sends one request to the action door carrying every selected id in `params._selectedIds` and no `recordId`. The door's api request builder read the empty subject record of that record-less dispatch as a row, found no `id` on it and answered `400 VALIDATION_ERROR` ("identifies its record by "id", but that field is not present on the record"), so the target was never called and the bulk dialog reported every row failed.

The builder now seeds `recordIdParam` only when the dispatch names a record, the same meaning of "record-less" its path interpolation already uses. A record-less run is forwarded with its params as written (`_selectedIds` included) and no `recordIdParam` key; a run on one record still seeds it from that row, and a run on a record whose row lacks the `recordIdField` or holds null for it is still refused. Both action doors (REST `POST /api/v1/actions/OBJECT/ACTION` and the MCP `run_action` tool) share the builder.
