---
'@objectstack/runtime': patch
---

fix(runtime): on the standalone server, an anonymous request whose JSON body cannot be parsed gets the domain's `401`, not the transport's `400`

Clause-②: no

On the standalone server (`os dev`, `os serve`: `HonoServerPlugin` with the dispatcher plugin), the routes the dispatcher mounts read the request body before handing the request to `dispatch()`. The transport refuses a body it cannot parse when the body is read, so the refusal answered first: an anonymous `POST /api/v1/keys` with `{"name": "probe"` (the closing brace missing) got `400 INVALID_REQUEST`, while the same request with a well-formed body got the promised `401 UNAUTHENTICATED`. The anonymous answer depended on whether the body parsed.

The mounts now hand the body on unread, and each domain reads it once its anonymous decision has admitted the caller. An anonymous caller gets the same answer whatever its body, on every mounted route that reads one, unscoped and `/environments/:environmentId`-scoped:

- `401 UNAUTHENTICATED` on `POST /analytics/query` and `/analytics/sql`; `/keys` (every verb); `POST /notifications/read` and `/notifications/read/all`; `POST /automation`, `PUT /automation/:name` and the two `trigger` doors, `toggle`, `clone`, `resume`, `cancel` and `restore-suspension`; the three `POST /actions/...` shapes; the `/ai/*` routes; the `/packages` routes; `POST /security/_activation/:type/:name` and `POST /security/permission-sets/:name/clone`.
- `/mcp` answers its own `401`, or, ahead of it, its `404` when MCP is switched off and its `501` when no MCP service is installed. None of the three reads the body, so a signed-in caller gets the `404` or `501` too.
- `/mcp/skill` is public and reads no body: a `POST` or `DELETE` gets its own `405` + `Allow: GET`, signed in or not.

Otherwise a signed-in caller with an unparseable body still gets the transport's `400 INVALID_REQUEST`: the body is read after the anonymous decision, not dropped. A `createHonoApp` host (`@objectstack/hono`) is unchanged; it already raised the refusal only when a domain read the body.
