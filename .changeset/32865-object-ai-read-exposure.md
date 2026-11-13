---
'@objectstack/spec': minor
---

feat(spec): `enable.aiReadable` — a system object's author can declare its records readable by the AI read tools, never writable

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/SKILL.md (the `enable` capability table has no `aiReadable` row; it should say the key is refused on any object whose name does not start with `sys_`, so an app author never writes it)

- **`ObjectCapabilities.aiReadable`** (`enable.aiReadable`, optional boolean, absent by default) is the per-object, read-only AI exposure of a system object, the read counterpart of an action's `ai.exposed` (ADR-0011). `true` declares that the AI read tools (query, get one, aggregate, describe, list) may reach the object's records, with every gate after admission unchanged: the caller's permissions, row-level security, field masking and the object's API exposure. It never opens a write; a write on a system object stays on its actions, each opened by its own `ai.exposed`. No deployment switch replaces the declaration.
- **Refused at parse** wherever an object is parsed (`ObjectSchema.create`, `defineStack`, `os validate`, the object save door): on any object whose name does not start with `sys_`, where the AI read tools already read records as the caller, so the key would change nothing and a `false` would read as a lock that locks nothing; and on the stored-metadata family (`STORED_METADATA_BODY_OBJECTS`: `sys_metadata`, `sys_metadata_history`), which no declaration opens. Any declared value is judged, `false` included. The key is new, so no stored object carries it.
- **No write arm.** `enable` declares no other AI key. `aiExposed`, `aiWritable`, `aiWrite`, `aiEditable` and `ai` inside `enable` are refused with the read-only prescription; `aiRead`, `aiReadEnabled`, `aiReadExposed` and `mcpReadable` are answered with a rename to `aiReadable`. A value other than a boolean is refused.
- **`isAiReadExposed(schema)`** and **`aiReadExposureRefusal(objectName, enable)`** are exported from `@objectstack/spec/data`. `isAiReadExposed` is the one reading a surface that admits an object to the AI read tools asks: it answers `false` for the stored-metadata family before it reads the key, `false` off a `sys_*` object, and `true` only for the boolean `true`.

Nothing reads the key at runtime yet: the MCP read tools still refuse every `sys_*` object by name, and the liveness ledger records the key as `planned`. The server half (the MCP bridge attesting the object through `isAiReadExposed`, the MCP object guards honouring the attestation, and `sys_approval_request` declaring the key) lands separately. The Studio object editor does not offer the key, because the objects it edits are the ones the parse refuses it on.
