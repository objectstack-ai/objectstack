---
'@objectstack/metadata-protocol': patch
---

Publishing a pure field reorder of an object now saves it. The object designer's drag-to-reorder used to answer success on publish, keep the old order and delete the draft (#21790).

Clause-②: yes

- `SysMetadataRepository` hashes each body as its type, so a reorder of an object's `fields` is a content change. It is written, recorded in history and served by `GET /api/v1/meta/object/:name`.
- **Rows stored before this release** keep the `checksum` they were written with. That value is still the version token: reads return it, `If-Match` tokens are derived from it, and the optimistic lock compares against it, so upgrading raises no conflict.
- For an object, "is this save a no-op?" is decided by hashing the stored body under the current rule, not by comparing against the stored checksum. An identical re-save of an old row writes no history row and keeps its checksum. A reorder into sorted key order is written too. Its new hash equals the old order-blind checksum, so a checksum comparison would have dropped it.
- A save that changes nothing returns the stored checksum as its version, so the receipt's token is the one the next `If-Match` save must send.
