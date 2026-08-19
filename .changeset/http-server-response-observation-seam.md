---
"@objectstack/spec": minor
"@objectstack/core": patch
"@objectstack/observability": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/runtime": patch
"@objectstack/http-conformance": patch
---

feat(spec): `IHttpServer` gains an optional `afterResponse` response-observing
hook so HTTP metrics are transport-agnostic instead of Hono-only (#9835)

The contract addition (additive — a new optional member plus the
`HttpResponseObservation` / `HttpResponseObserver` types and the reserved
`UNMATCHED_ROUTE_PATTERN` label): a transport invokes each registered observer
exactly once per answered request with `{ method, routePattern, status,
elapsedMs }`, after the response exists — the observation point the `use()`
middleware contract cannot express (it runs before dispatch and never sees a
status). `routePattern` is REQUIRED to be the registered route pattern
(`/api/v1/data/:id`), never the concrete path, so no adapter re-decides metric
cardinality. Optionality is feature-detected runtime-real
(`typeof server.afterResponse === 'function'`); a transport that does not
implement the seam reports **no** HTTP metrics — zero there means "not
instrumented", never "no traffic".

Implementations and consumers in the same change:

- `@objectstack/plugin-hono-server`: `HonoHttpServer` implements the seam (the
  ruled #9650 raw-app middleware becomes its delivery path — same reach,
  including `getRawApp()` mounts and middleware-refused 429s); unrouted
  requests are now labelled with the reserved `unmatched` pattern (previously
  they could surface as `/*`).
- `@objectstack/observability`: new `armHttpRequestCounter(server, metrics)`
  arms the `http_requests_total` counter through the seam at most once per
  server (first caller wins), which is what makes "exactly one counter per
  server" structural.
- `@objectstack/runtime`: the dispatcher offers its `observability.metrics`
  registry to the seam (a host that wires only the dispatcher now counts every
  inbound surface) and suppresses its own per-route copy of
  `http_requests_total` when the transport implements the seam — retiring the
  #9833 double count. Request-id echo, the duration histogram, the error
  counter and the error reporter are unchanged.
- `@objectstack/http-conformance`: `NodeHttpServer` implements the seam, and a
  new cross-adapter conformance suite locks the semantics for both adapters.
- `@objectstack/core`: re-exports the new contract types/constant.
