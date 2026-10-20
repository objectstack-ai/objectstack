---
'@objectstack/spec': patch
'@objectstack/runtime': patch
---

fix(spec, runtime): the endpoint publish refusal, the runtime's `unsupported` hint and the endpoint schema describes no longer say "in 17.x"

Clause-②: no (no accept set, served body shape or authz answer moves: only the wording of a refusal, a hint and three schema descriptions changes)

- These sentences named 17.x as the running major. On an 18.x runtime that made the refusal read as if the author were on the wrong version. Each one now states what the runtime does without naming a version: "This runtime executes only 'object_operation' and 'flow' endpoints." The behaviour is unchanged: `script` and `proxy` endpoints are still refused at publish, and `ApiMapping.transform` is still rejected.
- Where it shows: the `os build` / `os validate` refusal for a `script` or `proxy` endpoint, the `hint` in the runtime's `unsupported` answer (word for word the same sentence), and the published `ApiEndpoint.type`, `ApiEndpoint.target` and `ApiMapping.transform` descriptions in the JSON Schema and reference docs.
