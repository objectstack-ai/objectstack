---
'@objectstack/mcp': patch
---

fix(mcp)!: the stdio data bridge refuses a disabled package's data to every caller — a system context, and any caller on a host with no `protocol` service, included

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` says the stdio bridge serves a disabled package's data, to a system context or on any host; `content/docs/permissions/system-context.mdx` row 15 now says the bypass covers API exposure only

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: the change is which callers one runtime data door of the MCP stdio transport serves. Nothing `objectstack migrate meta` reads names it, and stored rows are untouched. -->

**BREAKING** for a host that hands the stdio data bridge a system context, or that registers no `protocol` service, and reads a disabled package's objects through it: those reads and writes are now refused `404 OBJECT_PACKAGE_DISABLED`, as `callData` (the HTTP `/mcp` bridge and every action door) already refuses them.

The bridge asks the disabled-package question first, of every caller, before its API-exposure gate: of the addressed object on every verb (`query`, `get`, `create`, `update`, `remove`, `aggregate`) and of every nested-relation condition's target, at every hop, with the condition's position as `param`. The relation conditions are found on the engine registry's own field map, as `callData` finds them, so a condition the engine lowers is asked even where neither the protocol nor the metadata service holds the object's definition. A `query_records` `expand` into such an object is withheld: the row is served, the related record is not. The question is the engine registry's `isObjectPackageDisabled`, the predicate `callData` asks, so a host with no `protocol` service refuses too. The `objectstack://` record resource asks the same question. A system context still skips the exposure question (`apiEnabled` / `apiMethods`), as before.

The fix: re-enable the package to read its data again. Nothing else changes for an enabled package.
