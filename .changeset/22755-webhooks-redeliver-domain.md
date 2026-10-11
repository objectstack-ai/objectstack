---
'@objectstack/runtime': patch
---

fix(runtime): the webhook redeliver button works on a kernel with no raw HTTP app — the dispatcher serves `POST /webhooks/redeliver`

Clause-②: no

On a self-hosted server, `@objectstack/plugin-webhooks` serves the operator's redeliver button by mounting `POST /api/v1/webhooks/redeliver` on the raw Hono app. A hosted tenant kernel has no raw app, so on that shape the path answered `404 ROUTE_NOT_FOUND`, even though the plugin had registered the `webhooks` service that can serve it.

**The door that changes: `HttpDispatcher`, for a kernel with no raw app.** It now serves exactly `POST /webhooks/redeliver` (no sub-paths, no other method). It forwards the request, body unread, to the request kernel's `webhooks` service (`IWebhookService.handleRedeliver`), read on every request, and returns that `Response` as it is. So the hosted door answers what the self-hosted mount answers: `200` with the replayed row, and the same `401`, `400`, `404` and `409` refusals with the same bodies. An anonymous call is refused `401 UNAUTHENTICATED` there exactly as on the mount.

- No `webhooks` service registered (plugin-webhooks absent, or present without its redelivery veto), or one without `handleRedeliver`: `501 NOT_IMPLEMENTED`, naming which. Never `ROUTE_NOT_FOUND`.
- A member that throws: a sanitised `500 INTERNAL_ERROR`, with the original error in the server log. The same answer, logged, when a transport hands over a request whose body was already read, instead of a "not JSON" refusal for a well-formed request.
- Any method other than `POST` is not claimed: it answers the dispatcher's ordinary `404 ROUTE_NOT_FOUND` and never reaches the service.
- The dispatcher's two gates apply to this path unchanged: a session that still owes an authentication step, or a signed-in caller who is not a member of the request's environment, is refused `403` before the service runs. This door is therefore stricter than the self-hosted mount, never looser.

Nothing changes on a self-hosted server: the plugin's raw-app mount still serves the path there and never reaches the dispatcher.
