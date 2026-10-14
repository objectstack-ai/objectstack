---
'@objectstack/trigger-api': major
'@objectstack/spec': patch
---

feat(trigger-api)!: the inbound hook door refuses the body-only `x-objectstack-signature` form, so only the timestamped, replay-protected form verifies

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an ObjectStack author writes moves: no spec key, metadata shape, authorable spelling, stored row, type or export signature is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime HTTP door's accept set: a signature value a third-party sender computes, outside any project's metadata or code. The sending side's guidance already teaches the one accepted form, and this changeset points to it rather than prescribing a rewrite. The other categories are closed on facts: both bumped packages publish (not unpublished); no ADR-0087 id covers this door and this diff adds none (not registered / already-registered); and no TypeScript declaration moves, since `verifySignature` keeps its signature and only its answer for one input narrows (not runtime-interface-only / type-surface-only). -->

**BREAKING**: an accept-set narrowing on a runtime door, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**What narrows, from → to.**

- `POST /api/v1/automation/hooks/:flowName/:hookId`, through the self-hosted mount and through `ITriggerApiService.handleInboundHook` alike. A post whose `x-objectstack-signature` was the body-only value (`sha256=` and the hex HMAC-SHA256 of the raw body under the flow's secret) was accepted, `202` and enqueued, with a deprecation `warn` line once per armed hook. It now gets the same `401 INVALID_SIGNATURE` every post that does not verify gets, and nothing is enqueued, even when the value is the secret's HMAC of the body. The body-only form signs no time, so it carries no replay protection.
- The one accepted form is the timestamped one: `t=<unix seconds>,v1=<hex>`, the HMAC-SHA256 of `<t>.<raw body>` under the flow's secret, refused when `t` is more than 300 seconds from the server clock.
- The deprecation line is gone. The refusal's `warn` line carries the cause `signature-body-only`, beside `unknown-flow`, `wrong-hook-id`, `signature-absent`, `signature-malformed`, `signature-mismatch` and `signature-outside-window`. It never carries the secret, the signature value or the body.
- `verifySignature(secret, rawBody, header)`, exported by `@objectstack/trigger-api`, answers as the door does: `true` only for the timestamped form inside its window, `false` for a body-only value. Its signature is unchanged.

**Unchanged: the outbound contract.** `@objectstack/core`'s `verifyHttpSignature` still verifies both forms, and `signHttpBody` still writes the body-only value: the messaging outbox and the flow `http` node sign it for third-party receivers, as the outbound webhook contract publishes. Only this inbound door refuses it.

**Who sees a difference.** A sender that signs the timestamped form, as the inbound-hook guidance teaches (the `objectstack-automation` skill's Inbound webhook section, `os explain flow-api-trigger-secret-missing`, `signHttpBodyAt` in `@objectstack/core`), sees none. A sender still on the body-only value now gets `401`, and the trigger's `warn` line for its post names `signature-body-only`, which tells an operator its secret is right and its signing form is the retired one.

**`@objectstack/spec`.** The `ITriggerApiService.handleInboundHook` docblock names the timestamped form as the only one accepted and the body-only form as refused. The type is unchanged.
