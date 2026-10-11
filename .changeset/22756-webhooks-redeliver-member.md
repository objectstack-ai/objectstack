---
"@objectstack/plugin-webhooks": minor
---

feat(plugin-webhooks): the `webhooks` service serves the redeliver door from a web-standard `Request` (`IWebhookService.handleRedeliver`), and the redelivery veto no longer waits for realtime (#22756)

Clause-②: yes

- **What is new.** The plugin registers the `webhooks` service and implements its optional `IWebhookService.handleRedeliver(request)` member: the webhook redeliver door, `POST /api/v1/webhooks/redeliver`, from a `Request` to a `Response`, with no raw app, no Hono context and no `http.server`. A hosted tenant kernel owns no socket, so this is how the door reaches it; its one caller is the runtime HTTP dispatcher's `POST /webhooks/redeliver` domain, which lands separately.
- **One door, two faces.** The member and the self-hosted route run the same code: the same session check, the same active-organization tenant, the same replay through `MessagingService.redeliverHttp` and the same answer for every outcome. For the same request they answer the same status, the same `Content-Type: application/json` and the same bytes: `401 UNAUTHENTICATED`, `400 INVALID_REQUEST`, `400 MISSING_REQUIRED_FIELD`, `404 RESOURCE_NOT_FOUND`, `409 DELIVERY_NOT_ELIGIBLE`, `409 DELIVERY_NEVER_SENT`, `500 INTERNAL_ERROR`, or `200` with the row's id and new status.
- **The redelivery veto is installed wherever the door is.** The veto that refuses to replay a webhook delivery whose subscription is gone, or whose signing secret cannot be recovered, now needs only the data engine and the messaging service. It used to be installed only when realtime was present and `autoEnqueue` was not `false`, so on other kernels such a delivery was replayed. It is now refused with `409 DELIVERY_NOT_ELIGIBLE` there too. The `webhooks` service is registered only where the veto is installed.
- **The route is found under `http.server` too.** The plugin reads `http.server` first, then the `http-server` alias. A host that registers its server only as `http.server` now gets the self-hosted route; one that registers it under both names gets it once.
- **The self-hosted route is otherwise unchanged.** Where it was mounted before, it answers the same status, headers and bytes for the same request, and it is never mounted twice.
