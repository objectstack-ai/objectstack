---
'@objectstack/objectql': patch
---

fix(objectql): a data driver receives the declared driver options and nothing else

Clause-②: no
Metadata-protocol: none

The engine → driver hop is a closed contract, as the engine's own option bags are: every driver call the engine makes is handed the keys `DriverOptionsSchema` declares and no other key.

- **Which calls.** `find`, `findOne`, `count`, `aggregate`, `insert`, `update` and `delete` (by id and multi-row), the reads and writes those verbs make along the way, and the raw `execute` door.
- **What arrives, unchanged.** `transaction`, `tenantId`, `tenantIds`, `timezone`, `preserveAudit` and `bypassTenantAudit` reach the driver exactly as before, and a caller's explicit value still wins. The schema's other declared keys pass when a caller sets them at a door that admits them, which is `insert` and the raw `execute` door; `find`, `findOne`, `update` and `delete` admit only the six keys above at their own door. The retired `timeout` tombstone is not handed on.
- **What stays with the engine.** Undeclared keys in a caller's engine option bag stay with the engine and are no longer copied onto a driver's options. A driver reads the query from its `query` argument, as the driver contract declares.
- **Hooks are unchanged.** An `after*` hook still reads `input.options` as the caller's bag with the driver options merged on.
- **Who moves.** A driver that read a key `DriverOptionsSchema` does not declare off its options argument: read the query from the `query` argument, or have the key declared on `DriverOptionsSchema` first. No driver in this repository reads one.
