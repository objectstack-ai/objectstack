---
"@objectstack/plugin-hono-server": minor
---

fix(hono-server): `http_requests_total` is emitted by the transport, so every inbound mount is counted (#9650)

The counter had exactly one emitter: a `Proxy` the runtime dispatcher built
over its **own** `IHttpServer` handle. It therefore saw only the routes the
dispatcher itself registered — and nothing else on the same server.

Measured, that left at least **14** inbound surfaces uncounted, in two
structurally different classes:

- plugins that mount through `getRawApp()` — auth (`/api/v1/auth/*`),
  metadata HMR, cloud-connection, marketplace, runtime-config, trigger-api,
  webhooks, approvals, the console SPA. These bypass `IHttpServer` entirely,
  so **no** wrapper at that level can ever reach them.
- plugins that resolve `http.server` themselves and mount through the verb
  methods — the REST data API via `RouteManager`, storage, i18n, settings,
  datasource admin.

The two highest-traffic surfaces an operator actually cares about, auth and
the REST data API, were both in that set. The documented guidance is to alert
on the 5xx rate derived from this counter, so a deployment could be melting
down on `/api/v1/*` with the counter flat.

The counter is now emitted from the Hono adapter itself, as a raw-app
middleware installed at the end of `HonoServerPlugin.init()` beside
`installMiddlewareSeam()` — the one layer every inbound request converges on,
whatever registered the handler.

**The route label is the matched PATTERN, never the concrete path.**
`/api/v1/data/:id`, not one series per record id; `/api/v1/auth/*`, not one
per sign-in endpoint. Cardinality has to stay bounded or the counter is
unusable for the alerting it exists for, and the label is unfixable in place
once dashboards are wired against the first shipped one.

**Wiring.** `HonoServerPlugin` takes a new `observability.metrics` option and
otherwise follows the canonical chain `ObservabilityServicePlugin` documents:
explicit option, then the `observability:metrics` service, then **nothing** —
with no backend configured no middleware is installed at all, so an
unconfigured deployment pays no per-request cost.

**Two consequences, stated rather than left to be discovered:**

- **A transport that does not implement this seam reports no HTTP metrics.**
  The seam is Hono's. Another `IHttpServer` implementation emits nothing until
  it grows its own, and a zero there means "not instrumented", never "no
  traffic". A response-observing hook on the `IHttpServer` contract is the
  transport-agnostic successor and is filed separately.
- **A request the `use()` chain refuses is still counted** — the seam is
  installed before the middleware seam, so the inbound rate limiter's `429`
  appears with `status="429"`. A preflight `OPTIONS` that the transport's own
  CORS built-in answers is **not** counted: it short-circuits earlier and
  never reaches a route.
