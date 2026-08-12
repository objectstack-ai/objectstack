---
"@objectstack/plugin-webhooks": patch
"@objectstack/objectql": patch
---

fix(plugin-webhooks): a webhook holding an encrypted signing secret re-arms the moment the CryptoProvider registers, instead of ~60s later (#8022)

For roughly **60 seconds after every server start**, a webhook whose
`signing_secret` is encrypted (the population #7799 created) was **not
subscribed**. A record change in that window produced no delivery **and no
`sys_http_delivery` row at all** — no dead letter, no retry, no durable trace
that anything was missed — while `GET /api/v1/data/sys_webhook/` kept reading
`active: true`, so the webhook looked armed in Setup the whole time. It
self-healed at the next periodic cache refresh, which is why it was invisible to
anyone not watching that window.

**The fail-closed behaviour is unchanged and is not the bug.** Dropping a
subscription whose stored key cannot be recovered — rather than delivering it
unsigned — is #7799's whole point and still holds: the signature is the
receiver's only proof of origin, and a webhook that stops arriving gets
investigated while one that keeps arriving unsigned teaches the receiver to
accept unauthenticated traffic. What was wrong is that a fail-closed drop
outlived its own cause.

**The ordering.** It was never a race that sometimes went the other way. Plugins
run inside `kernel:ready`, which `runtime.start()` completes; the host's
composition root calls `engine.setCryptoProvider(...)` only *after*
`runtime.start()` returns (`packages/cli/src/commands/serve.ts`,
`packages/verify/src/harness.ts`). So `AutoEnqueuer`'s first subscription-cache
build reliably preceded the capability it needs, dropped every secret-bearing
row on what it could see, and nothing re-read until the periodic refresh.

`ObjectQL` now reports the registration (`onCryptoProviderChange(listener)`,
fired after the provider is in place), and the auto-enqueuer subscribes
**before** its first build and rebuilds the cache when it fires. Re-arming is
immediate and event-driven — no polling, and no shorter-but-still-present
window. The re-arm deliberately does not join an in-flight refresh: the build
most likely running at that moment is the pre-registration one, and joining it
would report success having re-armed nothing.

The channel is feature-detected, as `resolveSecretField` already was — this
plugin takes no dependency on `@objectstack/objectql`. An engine without it keeps
the previous behaviour, with the periodic refresh as the backstop.

**The drop is also no longer quiet.** A subscription dropped for an unresolvable
key now reports at `error` with the consequence and the fix stated in the
message, and carries an ADR-0112 `code`/`status` pair (`INTERNAL_ERROR`/500) in
its metadata — the same pair the seeder's refusal for the same cause already
carried. Per AGENTS.md it is said **once** per outage per webhook rather than
every refresh cycle, and a webhook that recovers and breaks again is loud again.

Unaffected, and verified still true: the secret's bytes appear nowhere in
`sys_webhook` or in a delivery row, deliveries carry `signature` and never the
key (#7722), and a delivery whose key exists only as ciphertext after a restart
still produces the byte-identical HMAC receivers already verify.
