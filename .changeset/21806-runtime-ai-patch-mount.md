---
'@objectstack/runtime': patch
---

A declared `PATCH` AI route is reachable over HTTP: the dispatcher's `/ai/*` method wildcards mount `patch` beside `get`, `post`, `put` and `delete`, so `PATCH /api/v1/ai/conversations/:id` (the SDK's `ai.conversations.update`, the console's conversation rename) reaches its handler instead of answering `405` (#21806).

Clause-②: no

- **Where it failed.** On a host where the wildcards are the only door into `/ai/**`, a `PATCH` never reached the dispatcher. The server adapter answered `405 METHOD_NOT_ALLOWED` with `Allow: DELETE, GET, HEAD, POST, PUT`, because the path matched the wildcards under the four other verbs. Both bases the wildcards serve are fixed: `/api/v1` and `/api/v1/environments/:environmentId`.
- **An undeclared method still answers `405`.** The AI route table now tells its two misses apart. A method the table does not declare on a path it does declare answers `405 METHOD_NOT_ALLOWED`, with an `Allow` header that names exactly the declared methods, and no handler runs. A path the table declares under no method still answers `404 ROUTE_NOT_FOUND`. The rule is the same for every verb.
- **What a caller sees change.** A `GET`, `POST`, `PUT` or `DELETE` that names a declared AI path under the wrong method used to answer `404 ROUTE_NOT_FOUND`. It now answers `405` with `Allow`. A `PATCH` to an AI path the table does not declare at all used to answer the adapter's `405`. It now answers `404 ROUTE_NOT_FOUND`. No request that was refused before is served now, except a `PATCH` to a route the table declares.
