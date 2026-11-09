// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/trigger-api-service
 *
 * Cross-package contract for the inbound-hook trigger's service slot. The
 * implementation lives in `@objectstack/trigger-api` (ADR-0041 Tier 1), and
 * its `ApiTriggerPlugin` is what registers it, as the `trigger-api` service.
 * The slot key is the package's own name, the name ADR-0041 §2 gives the
 * trigger family. That registration is a separate change: until it lands no
 * kernel fills the slot, and a caller answers the absence rule below.
 *
 * [#22772] Why the inbound-hook door lives on this slot and not on the
 * automation service's (`IAutomationService`, the `automation` slot): the
 * automation service holds the trigger REGISTRY. `ApiTriggerPlugin`
 * registers its `api` trigger there, and the engine binds every
 * `type: 'api'` flow to it with the hook's config and a reader for its
 * secret. It owns none of the door. Looking the hook up, reading its secret,
 * checking the signature, parsing the body, enqueuing, and every answer the
 * sender gets are all the trigger's own (`ApiTrigger.handleRequest`). A
 * member on the automation slot would be declared on a service that does not
 * implement it, would exist on kernels that compose no inbound-hook trigger,
 * and would put the verifier one forwarding hop away from the contract that
 * names it.
 */

/**
 * The inbound-hook trigger's service: the occupant of the `trigger-api` slot.
 *
 * Every member is optional. A kernel without `@objectstack/trigger-api`
 * leaves the slot empty, and a caller probes for the member it needs before
 * calling it.
 */
export interface ITriggerApiService {
  /**
   * **The inbound hook, served transport-neutrally.** It is
   * `POST /api/v1/automation/hooks/:flowName/:hookId`, the door a third-party
   * sender (a payment provider, a code host) posts a signed event through to
   * start an `api` flow (ADR-0041 Tier 1). It is declared here as the first
   * segment of the bridge that the maintainer's ruling A on #22757 directs
   * for this endpoint.
   *
   * What it serves, exactly as the plugin's self-hosted mount serves it
   * today, in this order:
   *  - It looks up the hook armed for `hook.flowName` and compares
   *    `hook.hookId` with it in constant time. A post that names no armed
   *    flow, or the wrong hook id, gets the unverified-post refusal below,
   *    before any secret is read.
   *  - It reads that hook's own secret, at this moment, so a rotation applies
   *    to the next post. A secret that cannot be read answers
   *    `503 SERVICE_UNAVAILABLE`. ⛔ It never verifies against no secret.
   *    This `503` is the one residual of the refusal below: while an armed
   *    hook's secret cannot be read, a post that names that flow and its hook
   *    id gets this `503`, signed or not. It stays a `503` on purpose: it is
   *    the deployment's fault, a sender retries it, and it lasts only while
   *    the secret cannot be read.
   *  - Unless the hook declares its sender's own scheme (next item), it
   *    verifies the `x-objectstack-signature` header in its timestamped
   *    form, the only one it accepts: `t=<unix seconds>,v1=<hex>`, where the
   *    hex is the HMAC-SHA256 of `<t>.<raw body>` under that secret, and a `t`
   *    more than 300 seconds from the server's clock is refused. A missing or
   *    wrong signature, one outside that window, and one in the body-only form
   *    (`sha256=` and the hex HMAC-SHA256 of the raw body alone, which signs
   *    no time; refused even when it is the secret's HMAC of the body) get the
   *    unverified-post refusal below.
   *  - **A sender's own scheme, declared, REPLACES that check** for its hook:
   *    the start node's `config.signature`
   *    (`automation/api-trigger-signature.zod.ts`, for a vendor that signs its
   *    callbacks its own way). `apiTriggerVerifierOf` is the one reader of
   *    which verifier a hook has, and every hook has exactly one. Such a hook
   *    verifies the declared scheme under the key its `config.secretRef`
   *    names, read at this moment like any hook secret (the `503` above when
   *    it cannot be read), and nothing else: ⛔ it never reads
   *    `x-objectstack-signature`, so a valid one admits nothing, and ⛔ it
   *    never admits a post that lacks the declared header. The declared shape
   *    itself refuses a `header` that names `x-objectstack-signature` or
   *    another reserved header (`API_TRIGGER_SIGNATURE_RESERVED_HEADERS`: the
   *    request's credentials, routing or framing, or the idempotency key), in
   *    any case, so a declared scheme never reads one. A hook whose
   *    declaration the reader answers `unusable` admits no post at all: every
   *    post to it gets the one `401 INVALID_SIGNATURE` below, whether the
   *    trigger declines to arm the declaration or refuses each post. The
   *    implementer:
   *     - reads the declared `header`, its name matched without regard to
   *       case. A field the sender repeats is ONE value: the field values
   *       joined with `, ` in the order received (what `Headers.get`
   *       answers), and that joined value is the one verified, ⛔ never the
   *       first or the last field alone. For `signs: 'body'` the whole
   *       trimmed value, after `prefix` when one is declared (a value without
   *       it fails), is the one digest, so a repeated body-only header fails.
   *       For `signs: 'timestamp.body'` the value is `NAME=value` elements
   *       separated by `,`, each trimmed and split at its first `=`: exactly
   *       one element named `timestampElement`, whose value is whole unix
   *       seconds written as `x-objectstack-signature` writes its `t` (decimal,
   *       no sign, no leading zero, at most fifteen digits), and one or more
   *       named `digestElement` (a sender rolling its key sends one per key).
   *       An element with any other name is ignored. A missing, repeated or
   *       malformed timestamp, or no digest, fails.
   *     - computes the HMAC-SHA256, under the key, of the raw body exactly as
   *       received for `body`, or of `<t>.<raw body>` for `timestamp.body`,
   *       `<t>` being the timestamp element's value exactly as received.
   *     - decodes each received digest by `encoding` (`hex`, or `base64` in
   *       the RFC 4648 standard alphabet) and compares the 32 bytes with that
   *       HMAC **in constant time**. A digest that does not decode to 32
   *       bytes fails. The post verifies when one digest matches.
   *     - for `timestamp.body`, then refuses a `t` more than 300 seconds from
   *       the server's clock: the same window the `x-objectstack-signature`
   *       check applies (`HTTP_SIGNATURE_TOLERANCE_SECONDS` in
   *       `@objectstack/core`), never a window of its own.
   *    A `body` scheme signs no time, so **no replay window applies to it**:
   *    a captured post verifies again for as long as the key is unchanged.
   *    The sender offers nothing to bound a replay with, and this contract
   *    adds no bound of its own. A trigger that predates this form verifies
   *    `x-objectstack-signature` alone, so it refuses every post a declared
   *    sender makes; it never admits one unverified.
   *  - **One refusal for every post that does not verify** (#22806): an
   *    unknown flow, a wrong hook id, an absent signature and a bad one all
   *    answer `401 INVALID_SIGNATURE`, with one body. A post that fails a
   *    declared scheme, at any of its steps above, gets that same answer. So the answer does not
   *    tell an armed flow name from an unarmed one, whichever hook id a flow
   *    is armed with. The cause (which of those) goes to the server log,
   *    ⛔ never to the sender. FROM → TO: an unknown flow and a wrong hook id
   *    used to answer `404 RESOURCE_NOT_FOUND`; they now answer the same
   *    `401 INVALID_SIGNATURE` an absent or bad signature always has.
   *  - Only then does it read the body as JSON. A body that is not valid JSON,
   *    or not a JSON object, answers `400 INVALID_REQUEST`; an empty body is
   *    the empty object.
   *  - It enqueues the payload on the flow's queue, passing the
   *    `x-idempotency-key` header through to the queue's dedup window, and
   *    answers `202` with `{ accepted: true, messageId }`. The flow runs on the
   *    queue consumer, ⛔ never in-band with the request (ADR-0041 §5). With no
   *    queue service it answers `503 SERVICE_UNAVAILABLE`, and a publish that
   *    throws answers `503 ENQUEUE_FAILED`.
   *  - Every refusal is JSON in the `{ success: false, error: { code, message } }`
   *    envelope.
   *
   * **The member is the boundary (ruling A, condition 2).** The implementer
   * verifies INSIDE this member, through the same verifier the self-hosted
   * mount uses: a per-hook secret, a constant-time comparison, and
   * verification before anything is enqueued, so no run starts for a post
   * that did not verify. It reads the raw body from `request` itself, once,
   * the way the self-hosted mount reads it, and verifies the signature over
   * that body. ⛔ The caller never reads, parses or re-serialises the body
   * first. The sender signed its own bytes, and a body parsed and serialised
   * again differs from them (key order, whitespace, escapes), so it would
   * fail verification for every real sender. ⛔ Nor does the caller check,
   * pre-filter or short-circuit the signature: there is one verifier, and it
   * is behind this member. Anything the signing scheme carries beyond the
   * body (the accepted form's timestamp, for one, and a declared scheme's
   * own header) arrives in the same forwarded request, headers as received,
   * so this signature gains no field for it.
   *
   * **The signature is the only credential.** This member takes no
   * `ExecutionContext` and reads no session, cookie or `Authorization` header:
   * a third-party sender has no session, and the HMAC under the hook's own
   * secret (or, for a declared scheme, the key `config.secretRef` names)
   * carries the whole authorization. A signed-in caller is judged
   * exactly as an anonymous one, as on the self-hosted mount, which has no
   * auth gate.
   *
   * **Transport-neutral, deliberately.** A web-standard `Request` goes in and
   * a `Response` comes out. There is no Hono context, no raw app and no
   * `http.server` type. A hosted tenant kernel owns no socket, so it has no
   * raw app to mount the route on. The dispatcher reaches that kernel
   * instead, and this signature is the one a dispatcher can call.
   *
   * **The path parameters arrive as `hook`, never re-parsed from the URL.**
   * The route the caller matched is the one authority for them. On the
   * dispatcher, the request's URL can still carry the API prefix and an
   * `/environments/:id` scope that its router strips, and the allow-list row
   * that admits an anonymous sender matches these same segments. A member
   * that parsed the URL again could pick a hook other than the one the route
   * matched. Both values are decoded path segments, as the self-hosted
   * mount's router decodes them.
   *
   * **Its one caller** is the runtime `HttpDispatcher`'s exact
   * `POST /automation/hooks/:flowName/:hookId` domain (the next segment of
   * ruling A). That domain resolves the `trigger-api` slot on the request's
   * kernel, forwards the request with its body unread, and returns this
   * member's `Response` as it is. A request whose body the transport already
   * read is a server fault, which the caller answers as one rather than
   * forward, because the member would read an empty body and tell the
   * sender its signature is wrong. Ruling A admits the route on the ADR-0069
   * auth-gate allow-list as one exact `POST` row of four segments (that
   * segment adds it), so an anonymous sender reaches this member and nothing
   * else under `/automation` opens. The plugin's self-hosted raw-app mount is
   * not a caller, and the path is never mounted twice.
   *
   * **Optional, and its absence is loud.** A trigger-api service without the
   * door still satisfies this contract, so the caller probes for presence.
   * An empty `trigger-api` slot or an absent member answers a typed 404 or
   * 501, ⛔ never `ROUTE_NOT_FOUND`: that answer would tell the sender the URL
   * is wrong, when what is missing is the service behind it.
   *
   * @param request - The forwarded `POST`, body unread: the signature and the
   *   idempotency key are in its headers, and the signed payload is its body
   * @param hook - The two path parameters the caller's route matched: the
   *   flow's name, and the hook id its start node's `config.hookId` arms
   *   (`default` when it names none)
   * @returns The trigger's own JSON answer: `202` accepted, or its refusal
   */
  handleInboundHook?(
    request: Request,
    hook: { readonly flowName: string; readonly hookId: string },
  ): Promise<Response>;
}
