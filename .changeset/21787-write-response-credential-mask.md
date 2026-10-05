---
'@objectstack/core': patch
'@objectstack/runtime': patch
---

Credential-class field values are now masked on every write response, as on reads.

Clause-②: no

- A `secret` field, and a `password` field on an object that is not `managedBy: 'better-auth'`, already read back as `SECRET_MASK` (`null` when unset) on the generic read path (ADR-0100). Every write response that returns a record (REST, batch and MCP) now answers the same way.
- The shared write-response helper every write door already calls (`omitInternalFieldsFromWriteResponse`, `@objectstack/core`) now applies the credential mask before it omits `internal: true` fields. New exports beside it: `maskCredentialFieldsInWriteResponse` and `collectCredentialWriteResponseFields`, which read the same `isMaskedOnReadFieldType` declaration as the engine's read mask.
- `callData`'s fallback create and update arms (`@objectstack/runtime`, used when no protocol service is registered) now pass their response record through the same helper.
- Unchanged: the engine's own write results still return the stored row whole to privileged server-side callers, and the echoed-mask write guard still treats a `SECRET_MASK` value as "leave unchanged", so a client that saves back a write response does not overwrite the stored credential.
