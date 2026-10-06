---
'@objectstack/metadata-protocol': patch
---

A metadata row stored with no `checksum` can be edited and removed through the metadata door (#21978)

Clause-②: no

- `SysMetadataRepository` serves a `sys_metadata` row that carries no `checksum` as the hash of its stored body, but its `put` and `delete` compared the caller's parent with the raw column (`null`). So `PUT` and `DELETE /api/v1/meta/:type/:name` answered `409 METADATA_CONFLICT` ("Expected parent … but current is null") for every such row, with `If-Match` set to the version the door served and with no `If-Match` (last-write-wins) alike. A publish over such a row was refused the same way, as were the rollback and commit-revert doors, which take their parent from the same read. The datasource admin door stored such rows before it stamped them.
- `put` and `delete` now accept the version such a row is served as. A `null` parent still matches it, and a row with a `checksum` is judged exactly as before. A stale version is still refused with `409 METADATA_CONFLICT`, and the refusal now names the row's served version as the current one instead of `null`.
- The next write stamps the row's `checksum`, as every write does. Stored rows are not rewritten.
- Publishing a draft row stored with no `checksum` now also removes that draft row. Before, the post-promotion cleanup was refused by the same lock and the draft stayed pending, with nothing reported.
