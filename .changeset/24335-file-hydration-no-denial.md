---
'@objectstack/objectql': patch
---

fix(objectql): a record read that hydrates a file field no longer makes a `sys_file` access attempt for a reader without `sys_file` read

The engine expands a stored file id by reading `sys_file`, and it issued that read as the caller. A member who may read the record but not `sys_file` (the platform default) was refused it, and the security layer logged `[Security] Access denied: operation 'find' on object 'sys_file'` at WARN on every by-id and list read by that member, although the body served was right. Those lines buried the real denials in the operator's log.

The engine now asks the security service's `canReadObject('sys_file')` first, the same object-level read gate the security middleware applies, and serves a refused caller the field-owned answer without the read. Nothing else changes:

- The served body is byte-identical, by id and by list, for a reader with and without `sys_file` read. A file owned by the record still hydrates, and every other id still reads `{ id, metadataRefused: true }`.
- A direct `GET /api/v1/data/sys_file/:id` by the same reader still answers `403 PERMISSION_DENIED` and still logs its denial.
- With no security service, or one that offers no `canReadObject`, the engine reads as the caller, as before.

The ask is one cached permission check per read, not per row.

Clause-②: no (no accept set or public surface moves: the served bodies and every refusal are unchanged; owes the seat's review of record at `TIER_DEFAULT` before the queue)
