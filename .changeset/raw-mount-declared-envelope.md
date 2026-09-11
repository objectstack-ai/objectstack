---
'@objectstack/plugin-hono-server': patch
---

**`getRawApp()` mounts now answer an escaped throw with the declared ADR-0112 envelope.** A route mounted on the Hono handle funnels through neither the adapter's `wrap()` nor any registrar wrapper, so an escaped throw was answered by Hono's own default handler — `500 text/plain "Internal Server Error"`, no `success` flag, no `code`, and the thrown value's own declared `status` / `code` discarded. A transport error seam on the raw handle now renders the same throw-to-envelope rule a direct-mount route already used, so both doors answer one shape: a throw declaring `503` / `SERVICE_UNAVAILABLE` answers `503 application/json` with `{"success":false,"error":{"code":"SERVICE_UNAVAILABLE",…}}`, and a throw declaring no envelope still answers `500` with no cause in the body.

The escape hatch is unchanged: consumers still mount framework-natively, still stay outside `getMountedRoutes()`, and still need no adapter verb. A thrown value carrying its own `Response` (Hono's `HTTPException`) keeps the response it declared. A consumer that installs its own `getRawApp().onError(...)` replaces the seam.

Also fixed alongside it: `afterResponse` observers — and therefore `http_requests_total{status}` — reported a hard-coded `500` for any request that ended in a throw, which stops being the status actually sent once a declared envelope is rendered.
