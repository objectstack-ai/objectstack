---
'@objectstack/runtime': patch
---

feat(runtime): `/actions` calls an action by its namespace or `_env` (ADR-0150 D5)

Clause-②: yes (widening)
Metadata-protocol: none

`POST /api/v1/actions/:ns/:object/:action[/:recordId]` and `POST /api/v1/actions/:ns/global/:action` call the action that the package owning the installed namespace `:ns` declares, and run that package's handler. `_env` in that position calls the environment's own declaration. Both resolve through the same rule as the MCP `run_action` call with a `namespace`. Before this change each such path answered `404` ("no declaration"), because the namespace was read as an object name.

- A namespace whose package does not declare the action answers `404`, naming the namespace. So does `_env` for an action only packages declare.
- A namespace that two packages co-own, where both declare the name, answers `409 RESOURCE_CONFLICT` naming both.
- On an object, an addressed call reaches the declaration the holder binds to that object first, then the holder's object-less one. That is what the bare call reaches, and it is the order the engine finds a handler in. The MCP `run_action` call with a `namespace` reads the same rule.
- The activation write (`/actions/_activation/...`) has no addressed form and answers `404` when addressed.
- A first segment that is a literal (`global`, `_activation`), or that is not an installed namespace, reads as the bare path, which is unchanged.
