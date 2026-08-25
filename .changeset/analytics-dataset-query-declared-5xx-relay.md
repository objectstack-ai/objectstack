---
"@objectstack/rest": patch
---

fix(rest): `POST /analytics/dataset/query` relays a producer-declared 5xx instead of collapsing it to `500 ANALYTICS_QUERY_FAILED` (#11718)

**Response-contract change on a shipped public route.** The door is
`POST /api/v1/analytics/dataset/query` (and its environment-scoped twin). An
error whose producer declared a 5xx `status` now reaches the client with **that
status and that ADR-0112 `code`**, where the route previously answered a
hand-built `500` `ANALYTICS_QUERY_FAILED` for every one of them.

Measured door-to-door before the fix, one error object, both handlers driven in
process:

| face | answer |
|---|---|
| `POST /api/v1/data/:object` | `503` — `{"error":"Internal server error","code":"SERVICE_UNAVAILABLE"}` |
| `POST /api/v1/analytics/dataset/query` | `500` — `{"code":"ANALYTICS_QUERY_FAILED","error":"Internal server error"}` |

`/data` is the reference and does not move. Its relay is #5582's ruling — `502`
and `503` are `isExpectedDataStatus` lifecycle outcomes that proxies and retry
policies read differently from a `500`, so collapsing them destroys the
declaration — and that ruling never reached this route because the analytics
catch built its 5xx envelope by hand. The **sibling** analytics face
`/analytics/query` already relayed both halves through
`dispatcher-plugin.errorResponseBase`, so this door was the only one of three
overwriting a producer's declaration.

The repair imports `/data`'s own arm rather than restating it: the branch is
lifted into `declaredServerFaultAnswer` in `error-response.ts` and read by both
doors, the same way the 4xx arm already imports `classifiedRefusalAnswer`. A
third local opinion at this boundary is how the two faces came to disagree.

**Not a re-opening of #5352/#5367/#5811 — the prose is still withheld.** A
declared server fault's message is still replaced by the generic sentence, from
the same shared arm, and the full original text still reaches the operator: the
`logError` line runs *before* the relay branch and is unconditional, so a
producer cannot buy its way past the operator's log with a declared status. What
moves is the classification the producer declared and this route was
overwriting.

**What callers see change:**

- A declared `{ status: 503, code: 'SERVICE_UNAVAILABLE' }` → `503`
  `SERVICE_UNAVAILABLE` (was `500` `ANALYTICS_QUERY_FAILED`).
- An unregistered declared code demotes exactly as `/data` demotes it — `503`
  `{"code":"SERVICE_UNAVAILABLE","declaredCode":"WAREHOUSE_UNAVAILABLE"}` (#9232).
- `read-scope-sql`'s ten fail-closed RLS refusals answer `500`
  `READ_SCOPE_COMPILE_FAILED` instead of `500` `ANALYTICS_QUERY_FAILED`. Their
  2026-08-06 ruling is untouched in substance — still a SERVER fault, still
  `500`, still with the RLS policy content withheld from the body and intact in
  the log — and the code they now carry is the one they declare and the one the
  sibling `/analytics/query` face has always shipped to clients.

**Unchanged:** an *undeclared* fault. No declared status means nothing to relay,
so it keeps `500` `ANALYTICS_QUERY_FAILED` and #5667's tiering, which leaves a
self-authored fault readable. A declared **4xx** is untouched — that band is
arms ① and ①b, and the half-envelope rule (a 4xx status with no code invents no
code) still stands.
