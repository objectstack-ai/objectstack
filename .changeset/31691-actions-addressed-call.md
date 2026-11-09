---
'@objectstack/runtime': patch
---

feat(runtime): `/actions` calls an action by its namespace or `_env` (ADR-0150 D5)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which declaration an addressed action call reaches and what a four-segment `/actions` path answers; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

`POST /api/v1/actions/:ns/:object/:action[/:recordId]` and `POST /api/v1/actions/:ns/global/:action` call the action that the package owning the installed namespace `:ns` declares, and run that package's handler. `_env` in that position calls the environment's own declaration. Both resolve through the same rule as the MCP `run_action` call with a `namespace`. Before this change each such path answered `404` ("no declaration"), because the namespace was read as an object name.

- A namespace whose package does not declare the action answers `404`, naming the namespace. So does `_env` for an action only packages declare.
- A namespace that two packages co-own, where both declare the name, answers `409 RESOURCE_CONFLICT` naming both.
- On an object, an addressed call reaches the declaration the holder binds to that object first, then the holder's object-less one. That is what the bare call reaches, and it is the order the engine finds a handler in. The MCP `run_action` call with a `namespace` reads the same rule.
- The activation write (`/actions/_activation/...`) has no addressed form and answers `404` when addressed.
- A first segment that is a literal (`global`, `_activation`), or that is not an installed namespace, reads as the bare path, which is unchanged.

**BREAKING** for one answer (first-party count: 0, no first-party client sends a four-segment `/actions` path): a four-segment `POST /api/v1/actions/:x/:y/:z/:w` whose first segment is not an address now reaches the actions domain through the new mount, so its answer changes:

- It is still no route. The domain declines it, and it answers the dispatcher's no-route `404 ROUTE_NOT_FOUND`. Before, the transport answered its unmatched `404 ENDPOINT_NOT_FOUND` for it.
- A deeper `_activation` path is declined only behind the activation door's two gates, so a caller the gates refuse gets their `403` first.
- An anonymous caller gets `401`, as on every `/actions` path.
- Other verbs on a four-segment path get the domain's `405` with `Allow: POST`.

The fix: FROM a four-segment `/actions` path whose first segment is no address TO the three-segment bare path (`/actions/:object/:action/:recordId`) or the addressed path (`/actions/<namespace>/:object/:action/:recordId`).
