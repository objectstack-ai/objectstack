---
"@objectstack/spec": minor
---

feat(spec): a new webhooks service contract declares an optional, transport-neutral redeliver member (`IWebhookService.handleRedeliver`)

Clause-②: yes (widening)

- **What is new.** `@objectstack/spec/contracts` exports a new contract, `IWebhookService`, for the `webhooks` service slot that `@objectstack/plugin-webhooks` fills. It has one optional member, `handleRedeliver?(request: Request): Promise<Response>`. It serves the webhook redeliver door, `POST /api/v1/webhooks/redeliver`, the operator button that sends a finished delivery again.
- **What it serves.** The same answers as the plugin's self-hosted route. It authenticates the caller from the request's own credentials (`401 UNAUTHENTICATED` when nobody is signed in). It reads `{ "deliveryId": string }` from a JSON body (`400` otherwise). It replays the row through the messaging service, scoped to the caller's active organization (`404 RESOURCE_NOT_FOUND` for a row outside it). It answers `409` with `DELIVERY_NOT_ELIGIBLE` or `DELIVERY_NEVER_SENT` when the outbox refuses the replay, and `200` with the row's id and new status when it succeeds.
- **Transport-neutral.** A web-standard `Request` goes in and a `Response` comes out: there is no Hono context, no raw app and no `http.server` type. A hosted tenant kernel has no raw app to mount the route on, and the runtime dispatcher's `POST /webhooks/redeliver` domain is the member's one caller.
- **Why a webhooks slot, not the messaging service's.** The messaging service owns the replay itself. The door (who may press it, whose rows it reaches, what each refusal answers, and the veto over replaying a webhook whose subscription or secret is gone) belongs to the webhook plugin, so the door exists exactly where that plugin is composed.
- **Absence.** The member is optional, so a webhook service without the door still satisfies the contract. Its caller answers a typed 404 or 501 when the `webhooks` service or this member is absent, never `ROUTE_NOT_FOUND`.
- **Nothing changes for existing code.** No existing contract or member moved. Nothing registers the `webhooks` slot or calls the member yet: the plugin implementation and the dispatcher domain land separately, and the plugin's self-hosted route stays as it is.
