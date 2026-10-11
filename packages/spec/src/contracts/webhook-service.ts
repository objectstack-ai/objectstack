// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/webhook-service
 *
 * Cross-package contract for the outbound-webhook plugin's service slot. The
 * implementation lives in `@objectstack/plugin-webhooks` and is registered as
 * the `webhooks` service. The slot is named after the plugin's platform
 * capability token (`webhooks`), as the `approvals` slot is named after
 * plugin-approvals'.
 *
 * Webhook DELIVERY is not on this contract. A delivery is a row on the
 * messaging service's shared outbound-HTTP outbox (ADR-0018 M3), and
 * `@objectstack/service-messaging` owns sending it, retrying it and replaying
 * it. This slot carries what the webhook plugin owns on top of that outbox:
 * today, one door.
 *
 * [#22754] Why the redeliver door lives on this slot and not on the messaging
 * service's: the bridged behaviour is the door, and the door is this plugin's.
 * The plugin decides who may press it (any signed-in user), whose rows it
 * reaches (the caller's active organization), and what each refusal answers.
 * It is also what installs the messaging service's veto over replaying a
 * webhook row whose subscription or signing secret is gone, before it
 * enqueues its first row. So the door exists exactly where this plugin is
 * composed. A door on the messaging slot would also exist on a kernel without
 * this plugin, where that veto is never installed, and the dispatcher would
 * hold a second copy of the door's rules.
 */

/**
 * The webhook plugin's service: the occupant of the `webhooks` slot.
 *
 * Every member is optional. A kernel without `@objectstack/plugin-webhooks`
 * leaves the slot empty, and a caller probes for the member it needs before
 * calling it.
 */
export interface IWebhookService {
  /**
   * **The webhook redeliver door, served transport-neutrally.** It is
   * `POST /api/v1/webhooks/redeliver`, the operator button that sends a
   * finished delivery again (#22564; declared here as the first segment of
   * the bridge that the maintainer's ruling A on #22438 directs for this
   * endpoint).
   *
   * What it serves, exactly as the plugin's self-hosted mount serves it today:
   *  - It authenticates the caller from the request's own credentials, through
   *    the kernel's `auth` service. Any signed-in user may press it; with no
   *    signed-in user it answers `401 UNAUTHENTICATED`.
   *  - It reads a JSON body `{ "deliveryId": string }`. A body that is not
   *    JSON answers `400 INVALID_REQUEST`, and a `deliveryId` that is
   *    missing, not a string or blank answers `400 MISSING_REQUIRED_FIELD`.
   *  - It replays the row through the messaging service's redelivery, scoped
   *    to the caller's active organization (#10740). A row outside that
   *    organization is not found: `404 RESOURCE_NOT_FOUND`. ⛔ The tenant is
   *    never dropped and never bypassed.
   *  - A row the outbox refuses to replay answers `409` with the refusal's own
   *    code: `DELIVERY_NOT_ELIGIBLE` (the row is not finished, or the
   *    producer's veto refused it) or `DELIVERY_NEVER_SENT` (the row is a
   *    parked record that was never sent, so replaying it would send it
   *    unsigned).
   *  - Any other failure answers `500 INTERNAL_ERROR`.
   *  - A replayed row answers `200` with `{ success: true, data: { id, status } }`:
   *    the row's id and its new status. Every refusal is JSON in the
   *    `{ success: false, error: { code, message } }` envelope.
   *
   * **Transport-neutral, deliberately.** A web-standard `Request` goes in and
   * a `Response` comes out. There is no Hono context, no raw app and no
   * `http.server` type. A hosted tenant kernel owns no socket, so it has no
   * raw app to mount the route on. The dispatcher reaches that kernel
   * instead, and this signature is the one a dispatcher can call.
   *
   * **It takes no `ExecutionContext`.** It resolves the caller from the
   * request, which is the rule the self-hosted mount applies, so both kernel
   * shapes judge the same caller by one rule, in one place.
   *
   * **Its one caller** is the runtime `HttpDispatcher`'s exact
   * `POST /webhooks/redeliver` domain (the next segment of #22564). That
   * domain forwards the request with its body unread and returns this
   * member's `Response` as it is. The path is not on the ADR-0069 auth-gate
   * allow-list, so on that shape a signed-in caller whose session still owes
   * an authentication step is stopped before this member runs: the
   * dispatcher door is stricter than the self-hosted mount, never looser. The
   * plugin's self-hosted raw-app mount is not a caller, and the path is never
   * mounted twice.
   *
   * **Optional, and its absence is loud.** A webhook service without the door
   * still satisfies this contract, so the caller probes for presence. An
   * empty `webhooks` slot or an absent member answers a typed 404 or 501,
   * ⛔ never `ROUTE_NOT_FOUND`: that answer would tell an operator the URL is
   * wrong, when what is missing is the service behind it.
   *
   * @param request - The forwarded `POST`: the caller's credentials are in
   *   its headers, and the `deliveryId` is in its JSON body
   * @returns The JSON answer for the operator
   */
  handleRedeliver?(request: Request): Promise<Response>;
}
