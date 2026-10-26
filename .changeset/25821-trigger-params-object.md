---
'@objectstack/runtime': patch
---

fix(runtime)!: the flow trigger door refuses a `params` that is not a JSON object, instead of running the flow with an empty bag

`POST /api/v1/automation/:name/trigger`, its legacy spelling `POST /api/v1/automation/trigger/:name` (the route `client.automation.trigger()` calls), and every declared `type: 'flow'` API endpoint build the flow's context the same way. That build read `params` only when it was a truthy object. A string such as `{"params":"oops"}` became an empty params bag, and the flow ran with no inputs: it failed later with a misleading `400 FLOW_FAILED` "Unknown variable", or succeeded doing the wrong thing. An array was spread into an index-keyed bag (`{ "0": 1, "1": 2 }`). A falsy value (`null`, `0`, `false`, `""`) was read as an absent `params`, so the body's other top-level keys were forwarded as params instead.

These doors now answer `400 VALIDATION_FAILED` with one `fields[]` entry, `{ field: 'params', code: 'invalid_type' }`, whose message names the type received. The refusal comes before the flow is dispatched, so no run starts and no run row is written. It is the refusal the resume door already gives a non-object `inputs`, `variables` or `output`, and both doors now ask the question through one check, so their wording is the same.

Unchanged: an object `params` (an empty one included) builds the same bag as before, a body with no `params` key still forwards its other top-level keys as params, and an empty body still runs with an empty bag. An unknown flow still answers `404`, and a caller the flow refuses still answers `403`, before the body is judged.

Clause-②: no (narrowing) — the trigger doors refuse request shapes they used to dispatch: a `params` that is a string, number, boolean, array or `null`. Nothing is widened.

Metadata-protocol: none (an HTTP request body's handling at the trigger doors; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is how the flow trigger doors handle a request body whose `params` is not a JSON object: it is refused instead of dropped. The remedy is a request edit (send `params` as an object, or leave it out), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that sent `params` as something other than an object and relied on the flow running anyway, shipped as `patch` because the metadata protocol does not move.

- **Before.** A non-object `params` was dropped (or, for `null` and the other falsy values, replaced by the body's other keys), and the flow was dispatched.
- **Now.** The request is refused with `400 VALIDATION_FAILED` naming `params`, and nothing runs.
- **Fix.** Send `params` as an object of flow input names to values, for example `{"params":{"ownerId":"u1"}}`, or leave the key out.
