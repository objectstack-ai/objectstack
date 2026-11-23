---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(runtime)!: `callData` refuses a disabled package's data at every relation hop and for a system context too; the MCP stdio bridge asks every hop

Clause-②: no (narrowing: `callData` newly refuses 404 `OBJECT_PACKAGE_DISABLED` for a nested-relation condition into a disabled package's object at any hop, not only directly beneath the queried object's lookup, for every caller including a system context, and refuses a disabled package's addressed object for a system context and on a host with no protocol service; a non-system caller is also refused 404 `OBJECT_API_DISABLED` / 405 `OBJECT_API_METHOD_NOT_ALLOWED` for an unexposed target past the first hop, on `callData` and on the MCP stdio bridge; no export is added or removed)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: every moved answer is what the protocol's data route already answers for the same object and the same condition. A caller that needs those records re-enables the package or exposes the object. -->

**BREAKING** for callers of `callData` on an environment that disables a package or declares an object unexposed, and for the MCP stdio bridge. The engine lowers a condition beneath a condition (`{ "c_ref": { "b_ref": { "field": VALUE } } }`) up to three relationships, reading each related object, so the refusal that stopped at the first hop still answered a count of 1 for a stored value and 0 for any other one relationship further. The protocol's data route refuses every hop and every caller.

- FROM: `callData`'s `aggregate` arm and its no-protocol `query` fallback asked only the first hop of a relation condition, and skipped the disabled-package question for a system context; on a host with no protocol service, a disabled package's object addressed directly was served to every caller, and so was any disabled package's object addressed by a system context on the `aggregate` arm. The MCP stdio bridge asked the exposure question of the first hop only.
- TO: every target on the way is asked, disabled package first and then exposure, and refused with its full position as `param` (for example `where.c_ref.b_ref`). The disabled-package question is asked of every caller, a system context included, for the addressed object and for every relation target; the exposure question still skips a system context. The MCP stdio bridge asks both questions at every hop of a non-system caller's condition.

Who changes: a host that hands `callData` a system context (`HttpDispatcher.handleMcp` / `buildMcpBridge`, `dispatchAction`) now gets the data route's refusal for a disabled package's data; no door in this repository hands `callData` a system context, and a hook's `ctx.api` never passes through it. The fix for a caller that needs the records: re-enable the package, expose the object, or filter on the lookup's stored id. An environment with no disabled package and no unexposed object sees no change.
