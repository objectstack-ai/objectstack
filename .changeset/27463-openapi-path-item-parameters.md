---
'@objectstack/connector-openapi': patch
---

fix(connector-openapi): parameters declared on an OpenAPI 3.x path item reach the input schema of every action under that path

Clause-②: no — only the generated action's `inputSchema` (what `GET /automation/connectors` shows an author or the flow designer) gains the path-level parameters the document already declares; nothing validates a call's input against that schema, so every call accepted before is still dispatched as before.
Metadata-protocol: none

A Path Item Object's `parameters` apply to every operation under that path, and the generator read only each operation's own `parameters`. So a document that declares an id once on the path, the usual vendor shape for GET / PATCH / DELETE on one resource (`'/pets/{petId}': { parameters: [{ name: 'petId', in: 'path', required: true }], get: …, delete: … }`), produced actions whose input schema had no `petId` at all, and none when that was the only parameter.

- **Now.** Each operation's parameters are its path item's `parameters` followed by its own. An operation entry with the same `name` and `in` as a path-level one replaces it whole (its schema and its `required`), as OpenAPI defines; a path-level and an operation-level parameter that share a name but not `in` are both kept.
- **Unchanged.** An operation under a path item with no `parameters` gets exactly its own, as before. A `$ref` parameter is still left to the caller to de-reference and is skipped when it is not. A Swagger 2.0 document converted by `normalize-openapi` gets the same fix: the conversion keeps path-level parameters on the path item (in 3.x form), so they were dropped the same way before and arrive now.
