---
'@objectstack/service-automation': patch
---

fix(service-automation): a connector pull never creates a record whose match key is blank — the record is a row error, so the job run is `degraded`, not `success`

Clause-②: no
Metadata-protocol: none

A `job.pull` whose mapping writes in `upsert` mode used to create a pulled record that carries no value for the mapping's `upsertKey` as a NEW row with an empty key, and the run still said `success`. A source that renamed or dropped its id column therefore duplicated every changed record on each pull, and no later pull could match the copies again. The pull now hands the import runner `skipBlankMatchKey: true` and reports each such record as a failed row (`BLANK_MATCH_KEY`, the message naming the mapping and its `upsertKey`), with one warning per pull. A failed row makes the job's run outcome `degraded`, with the mapping and the counts as its reason. In `update` mode the same record used to be a silent skip; it is now the same row error.

The import door (`POST /api/v1/data/:object/import`) is unchanged: there `skipBlankMatchKey` stays the caller's choice, and with it off an `upsert` still creates the blank-key row.
