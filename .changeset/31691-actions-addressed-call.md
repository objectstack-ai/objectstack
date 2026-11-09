---
'@objectstack/runtime': patch
---

feat(runtime): `/actions` calls an action by its namespace or `_env` (ADR-0150 D5)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which declaration an addressed action call reaches and what a four-segment `/actions` path answers; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

`POST /api/v1/actions/:ns/:object/:action[/:recordId]` and `POST /api/v1/actions/:ns/global/:action` call the action that the package owning the installed namespace `:ns` declares, and run that package's handler. `_env` in that position calls the environment's own declaration. Both resolve through the same rule as the MCP `run_action` call with a `namespace`. Before this change such a path answered `404` ("no declaration") in the common case, because the namespace was read as an object name; the exception is the narrowing below.

- A namespace whose package does not declare the action answers `404`, naming the namespace. So does `_env` for an action only packages declare.
- A namespace that two packages co-own, where both declare the name, answers `409 RESOURCE_CONFLICT` naming both.
- An addressed path is two or three segments after its qualifier, the shapes above. One segment (`/actions/:ns/:action`) answers the door's shape `404`; more than three are declined, as the bare path is.
- On an object, an addressed call reaches the declaration the holder binds to that object first, then the holder's object-less one. That is what the bare call reaches, and it is the order the engine finds a handler in. The MCP `run_action` call with a `namespace` and an `objectName` is the same call: when it reaches the holder's object-less declaration, the caller's object stays the subject (the gates judge it, `recordId` is loaded from it, and the handler runs under it), as on REST.
- The activation write (`/actions/_activation/...`) has no addressed form and answers `404` when addressed.
- A first segment that is a literal (`global`, `_activation`), or that is not an installed namespace, reads as the bare path, which is unchanged.
- Known gap, not narrowed here: an action that one package declares standalone and binds to an object another package's object embeds an action of the same name for is not reachable by its address. The declaration collector keeps one declaration per `object:name` whatever package ships it, so `/actions/<that package's namespace>/<object>/<name>` answers `404`, or reaches that package's object-less declaration of the name if it has one. Keying the collector by package would also narrow the bare door, so it is left to its own change.

**BREAKING**, three answers (first-party count: 0 for each; no first-party client sends a path past three segments, and an object segment never equals a namespace, because the install gate refuses that in both directions):

- **A path past three segments whose first segment is not an address.** It is no route, and the actions domain now declines it (`handled: false`) on every host.
  - Mounted host (the dispatcher plugin on the standalone server): a four-segment `POST` reaches the domain through the new four-segment mount and answers the dispatcher's no-route `404 ROUTE_NOT_FOUND`. Before, the transport answered its unmatched `404 ENDPOINT_NOT_FOUND`. Five segments and more still reach no mount and keep the transport's answer.
  - Catch-all host (`createHonoApp`, which hands every path to `dispatch()`): on base the domain read the first three segments and ran the call with the rest ignored, and a deeper `_activation` path answered that door's shape `400` behind its gates. Now the dispatch is declined and the host answers its own `404`.
  - A deeper `_activation` path is declined only behind the activation door's two gates, so a caller the gates refuse gets their `403` first. An anonymous caller gets `401`, as on every `/actions` path. Other verbs on a four-segment path get the domain's `405` with `Allow: POST`.
- **A bare-looking path whose first segment is an installed namespace** is now that namespace's address (ADR-0150 D5 step 2). On base the bare door admits an object-less action under any first segment, so `POST /actions/crm/log_call` ran a one-holder object-less `log_call` whoever held it, and `POST /actions/crm/lead/convert` ran an object-less action named `lead` if one existed. The first now answers the addressed shape `404`; the second is crm's `convert` on `lead`, or `404` naming the namespace.

The fix: FROM a path past three segments TO the three-segment bare path (`/actions/:object/:action/:recordId`) or the addressed path (`/actions/<namespace>/:object/:action/:recordId`); FROM an object-less call spelled under a namespace TO `/actions/global/:action` (bare) or `/actions/<namespace>/global/:action` (addressed).
