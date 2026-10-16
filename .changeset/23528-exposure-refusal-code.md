---
'@objectstack/runtime': patch
---

fix(runtime): `callData`'s exposure refusal for the object a request addresses carries the data door's code, `OBJECT_API_DISABLED` (404) or `OBJECT_API_METHOD_NOT_ALLOWED` (405), on the dispatcher's `/data` routes, the `/mcp` data tools and declared endpoints (#23528)

Clause-②: no

**What was wrong.** An object can declare `apiEnabled: false` or an `apiMethods` whitelist. The runtime dispatcher's exposure check for the object a request addresses (`refuseUnexposedDataAction`, which every `callData` asks first) refused with a status and a message but no `code`. So:

- the dispatcher's `/data` routes derived a code from the status: `404 RESOURCE_NOT_FOUND` / `405 METHOD_NOT_ALLOWED`;
- the `/mcp` data tools rendered the message alone;
- a declared endpoint whose target is an object answered the derived code too.

`RestServer` and the MCP stdio tools answer the same declaration `OBJECT_API_DISABLED` / `OBJECT_API_METHOD_NOT_ALLOWED`, and so did the dispatcher's own refusal of a nested-relation filter on an unexposed object.

**What a caller reads now.** Every one of these doors answers the data door's code with the same status as before:

| door | declaration | FROM | TO |
|:--|:--|:--|:--|
| dispatcher `/data` (and declared endpoints) | `apiEnabled: false` | `404`, `error.code` `RESOURCE_NOT_FOUND` | `404`, `error.code` `OBJECT_API_DISABLED` |
| dispatcher `/data` (and declared endpoints) | verb outside `apiMethods` | `405`, `error.code` `METHOD_NOT_ALLOWED` | `405`, `error.code` `OBJECT_API_METHOD_NOT_ALLOWED` |
| `/mcp` data tools | either | `isError: true`; the text is the message | `isError: true`; the text is `{ "error": { "code", "message", "status" } }` |

The status and the message do not change. The thrown value is now an `Error` carrying `code`, `status`, the addressed object as `object`, and the effective operation set as `allowed` on a 405. A caller that branched on `RESOURCE_NOT_FOUND` / `METHOD_NOT_ALLOWED` for an exposure refusal on these doors should branch on the two `OBJECT_API_*` codes, as it already does for `RestServer`.
