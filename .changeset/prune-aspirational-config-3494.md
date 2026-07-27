---
"@objectstack/spec": minor
---

feat(spec)!: prune the still-dead aspirational config from Theme / Translation / Webhook (#3494)

Removes the authorable-but-never-consumed props confirmed dead by the 2026-06
liveness audit (follow-up to #1878/#1893; same treatment as the #2377 and
#3464 prunes). Authoring any of these was a silent no-op.

## Removed

**Theme** (`ThemeSchema`) — the theme engine (objectui `generateThemeVars`)
never emitted or consumed them:
- Props: `spacing`, `breakpoints`, `logo`, `density`, `wcagContrast`, `rtl`,
  `touchTarget`, `keyboardNavigation`
- Exports: `SpacingSchema`, `BreakpointsSchema`, `DensityModeSchema` (+
  deprecated `DensityMode` alias), `WcagContrastLevelSchema` (+ deprecated
  `WcagContrastLevel` alias), and the `Spacing` / `Breakpoints` /
  `DensityMode` / `WcagContrastLevel` types

**Translation** (`TranslationConfigSchema`) — no runtime reader; there is no
ICU engine and interpolation is always simple `{variable}` substitution:
- Props: `fileOrganization`, `messageFormat`, `lazyLoad`, `cache`
- Exports: `MessageFormatSchema`, `TranslationFileOrganizationSchema`, and the
  `MessageFormat` / `TranslationFileOrganization` types

**Webhook** (`WebhookSchema`) — the delivery path always sends its own fixed
envelope and only applies HMAC signing via `secret`; delivery retries are owned
by the messaging outbox's fixed schedule:
- Props: `body`, `payloadFields`, `includeSession`, `authentication`
  (bearer/basic/api-key were never attached; HMAC via `secret` stays),
  `retryPolicy`, `tags`
- Exports: the entire inbound `WebhookReceiverSchema` + `WebhookReceiver` type
  (never consumed by any runtime)

## Migration

Delete these keys from your configs — they never did anything, so removing
them changes no behavior. Parsed output no longer contains the previously
defaulted keys (`includeSession: false`, `fileOrganization: 'per_locale'`,
`messageFormat: 'simple'`, `lazyLoad: false`, `cache: true`). Webhook HMAC
signing (`secret`), `headers`, and `timeoutMs` are unaffected. File layout for
translations remains a pure authoring convention — no config knob needed.

## Deliberately NOT removed

- Translation `supportedLocales` — it has a live reader (pinyin-search
  capability toggle in `serve.ts`).
- Job `retryPolicy` / `timeout` — being implemented (built, not pruned) in the
  #3494 follow-up PR.
- The materialized webhook props (`name`, `object`, `triggers`, `url`,
  `method`, `headers`, `timeoutMs`, `secret`, `isActive`, `description`,
  `label`) — live via the #3489 bridge; ledger flip tracked in #3490.

Refs #3494, #1878, #1893.
