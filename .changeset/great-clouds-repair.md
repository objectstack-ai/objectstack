---
'@objectstack/plugin-hono-server': patch
---

`GET /auth/me/localization` answers the deployment's resolved `currency` and `timezone` instead of `null`

The handler read both off the request `ExecutionContext`, citing ADR-0053, but the resolver serving this surface is a hand-rolled envelope that never carried them — so every authenticated caller was answered `currency: null, timezone: null` whatever the `localization` settings said, and the console's regional-formatting seed was fed nulls. All three values now come from one reading of the same `resolveLocalizationContext` cascade the dispatcher's shared assembler uses. `locale` resolution is unchanged. `timezone` now always answers (cascade floor `UTC`); `currency` still answers `null` when the deployment configures none — that value has no floor.
