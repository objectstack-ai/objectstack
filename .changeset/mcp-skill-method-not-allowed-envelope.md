---
"@objectstack/runtime": patch
---

fix(runtime): `POST /api/v1/mcp/skill` answers the standard error envelope, not the adapter's hand-rolled 405 (#7649)

A method mismatch on the public SKILL.md route returned a body no other error on
this API returns:

```json
{ "error": "Method Not Allowed", "code": "METHOD_NOT_ALLOWED",
  "message": "POST is not supported for /api/v1/mcp/skill. Allowed: GET.",
  "method": "POST", "path": "/api/v1/mcp/skill", "allowed": ["GET"] }
```

instead of the standard `{success:false, error:{code, message, httpStatus}}`
carrying the documented message *"Method not allowed — use GET"*. A client
branching on `error.code` read `undefined`, because `error` was a string.

**The 405 branch was never missing.** `handleMcpSkillRequest` has had one since
#3842 routed it through `buildApiError`. The defect was one layer above it:
`createDispatcherPlugin` mounted `${prefix}/mcp/skill` for **GET only**. Since
GET is the only method the route serves, that read as correct — but an unmounted
verb never reaches the dispatcher at all. Hono sends it to `notFound`, where the
adapter's `unmatchedResponse()` re-matches the path across verbs and answers 405
with its own shape. The domain's branch was dead code on this adapter, and the
API had two 405 envelopes depending on which route you hit.

`/mcp/skill` is now mounted for the same verb set as its sibling `/mcp`
(GET + POST + DELETE), so the mismatch reaches the branch that already exists.
No new 405 logic was written, and `GET /api/v1/mcp/skill` is untouched — same
200, same `text/markdown`, same `cache-control: no-store`.

Note for callers that parse the old body: the `method`, `path` and `allowed`
keys are gone from this route's 405, and `error` is now an object. The `Allow`
response header remains the interoperable place to read the hint, and now
reads `GET` — the domain branch's own literal — where the adapter previously
derived `GET, HEAD` from its route table (Hono registers HEAD implicitly
beside every GET). `HEAD /api/v1/mcp/skill` is still served either way.
