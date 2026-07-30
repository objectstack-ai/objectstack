---
"@objectstack/spec": minor
"@objectstack/rest": minor
"@objectstack/runtime": minor
"@objectstack/cloud-connection": minor
"@objectstack/plugin-auth": minor
"@objectstack/plugin-webhooks": minor
"@objectstack/service-messaging": minor
"@objectstack/service-automation": minor
"@objectstack/metadata-protocol": minor
"@objectstack/metadata-core": minor
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
`NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get
codes registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
`PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
`cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
`service-messaging`, `service-automation`.

**Three routes stop putting a code in the message slot.** The webhook redeliver
route and two `rest` routes answered `{ success: false, error: '<code>',
message }` — the code occupying `error`, the declared object envelope nowhere.
They now emit `error: { code, message }`. Clients reading `body.error` as a
string on these routes must read `body.error.code`.

**`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
`@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
two `RetryStrategy` types. The connector-side pair is renamed; importers of the
`integration` subpath update the name. Side effect: the api-side `ErrorCategory`
and `RetryStrategy` now appear in the generated API reference at all — the
name collision had been silently dropping them.

**Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase
values (ADR-0112 D6b): it is persisted audit history, and the same column holds
non-error outcomes (`ok`, `lock_override`). Field-level codes stay as they are
(D6, #3977).
