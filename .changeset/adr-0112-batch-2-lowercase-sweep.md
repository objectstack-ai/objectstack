---
"@objectstack/spec": minor
"@objectstack/rest": minor
"@objectstack/runtime": minor
"@objectstack/cloud-connection": minor
"@objectstack/plugin-auth": minor
"@objectstack/plugin-approvals": minor
"@objectstack/plugin-webhooks": minor
"@objectstack/service-messaging": minor
"@objectstack/service-automation": minor
"@objectstack/metadata-protocol": minor
"@objectstack/metadata-core": minor
"@objectstack/trigger-api": minor
"@objectstack/hono": minor
---

refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
the set; this batch moves the emitters that still spoke lowercase `snake_case`
onto it.

**Wire-visible change.** Error codes on these surfaces change spelling. Generic
conditions collapse onto the standard catalog rather than keeping a synonym:
`unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
`PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
`INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
`NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
`PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
`cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
`service-messaging`, `service-automation`, `trigger-api`.

Branch on `error.code` values rather than pattern-matching their case: the
console's fix for the same rename (objectui#2977) reads codes case-insensitively
for exactly this reason, and that is the pattern to copy in your own consumers if
you support servers on both sides of the change.

**Four routes stop putting a code in the message slot.** The webhook redeliver
route, the API-trigger webhook, and two `rest` routes answered
`{ success: false, error: '<code>', message }` — the code occupying `error`, the
declared object envelope nowhere. They now emit `error: { code, message }`, and
three API-trigger branches gained a message they never had. Clients reading
`body.error` as a string on those routes must read `body.error.code`.

**`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
`@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
two `RetryStrategy` types. The connector-side pair is renamed; importers of the
`integration` subpath update the name. Side effect: the api-side `ErrorCategory`
and `RetryStrategy` now appear in the generated API reference at all — the name
collision had been silently dropping them.

**`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
registration route put better-auth's arbitrary `body.error` string straight into
`error.code`. The code is now ours and the upstream discriminator moved to
`details.upstreamError`.

**Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
(ADR-0112 D6b): it is persisted audit history, and the same column holds
non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
`--json` output contract.

A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
code position, since the ledger's casing rule can only police codes that someone
registers.
