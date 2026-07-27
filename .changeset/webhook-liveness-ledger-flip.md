---
---

chore(spec): flip webhook liveness ledger dead→live + webhook-materialization ADR-0054 proof (#3490)

Follow-up to #3489 (the materializer bridge). Now that stack-authored webhooks
are materialized into dispatchable `sys_webhook` rows, the props the materializer
+ dispatcher actually consume flip from `dead` to `live` in
`packages/spec/liveness/webhook.json` (`object`/`isActive`/`url`/`triggers`/
`method`/`name`/`headers`/`secret`/`timeoutMs` + display-only `label`/
`description`); `body`/`payloadFields`/`includeSession`/`retryPolicy`/`tags` stay
`dead` (folded into `definition_json` but never read — the #1878 delivery-layer
worklist) and `authentication` stays `experimental`. The `url` authorWarn is
dropped (authoring is live now).

Adds a `webhook-materialization` ADR-0054 high-risk proof class (bound to
`webhook.object`) with a `@objectstack/dogfood` proof that boots the real stack
WITHOUT realtime and asserts the row materializes — pinning the #3461 integration
seam (the bridge was first gated behind the realtime dispatch guard).

Liveness-ledger + gate assets (`packages/spec/liveness` + `scripts/liveness`, not
in the published spec runtime) and the private `@objectstack/dogfood` package
only — no package release.
