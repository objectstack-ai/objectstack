---
'@objectstack/runtime': patch
---

fix(runtime)!: the action door refuses a `params` that is not a JSON object, and the flow trigger door refuses a body that is not one, instead of running with an empty bag

`POST /api/v1/actions/:object/:action` read `params` only when it was a truthy object. A string such as `{"params":"oops"}` became an empty params bag and the action ran anyway, answering `200` and starting a run the same as `{"params":{}}`; an array was handed on as the bag itself.

`POST /api/v1/automation/:name/trigger`, its legacy spelling `POST /api/v1/automation/trigger/:name`, and every declared `type: 'flow'` API endpoint read the request body only when it was a truthy object. A JSON string body dispatched the flow with an empty bag, so it failed later with a misleading `400 FLOW_FAILED` "Unknown variable" or ran doing the wrong thing, and an array body forwarded its indices as params.

Both now answer `400 VALIDATION_FAILED` with one `fields[]` entry, `{ field: 'params', code: 'invalid_type' }` on the action door and `{ field: '(body)', code: 'invalid_type' }` on the trigger door, whose message names the type received. The refusal comes before anything is dispatched, so no run starts and no run row is written. It is the refusal the resume door already gives a non-object body, and the three doors now ask the question through one check, so their answers have the same shape; the resume door's `fields[]` message now also names the type received.

Unchanged: an object `params` (an empty one included) reaches the action as before, and an action body with no `params` key still runs with an empty bag. A trigger with no body, or a JSON `null` body, still runs with an empty bag. An unknown action or flow still answers `404`, and a caller the action or flow refuses still answers `403`, before the body is judged.

Clause-②: no (narrowing) — the action door refuses a `params` that is a string, number, boolean, array or `null`, and the trigger doors refuse a body that is a string, number, boolean or array. Nothing is widened.

Metadata-protocol: none (an HTTP request body's handling at the action and trigger doors; nothing a metadata author writes changes)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is how the action and flow trigger doors handle a request whose `params` or body is not a JSON object: it is refused instead of dropped. The remedy is a request edit (send `params` or the body as an object, or leave it out), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that sent the action door's `params`, or the trigger door's body, as something other than an object and relied on the call running anyway, shipped as `patch` because the metadata protocol does not move.

- **Before.** A non-object `params` on the action door, or a non-object trigger body, was dropped (an array trigger body was forwarded as index-keyed params), and the action or flow was dispatched.
- **Now.** The request is refused with `400 VALIDATION_FAILED` naming `params` or `(body)`, and nothing runs.
- **Fix.** Send `params` as an object of input names to values, for example `{"params":{"note":"x"}}`, and send a trigger body as an object (`{"params":{"ownerId":"u1"}}` or a flat `{"ownerId":"u1"}`), or leave either out.
