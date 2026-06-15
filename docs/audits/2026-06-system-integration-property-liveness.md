# Audit: System/Integration metadata liveness & necessity

**Date**: 2026-06-15 · **Scope**: EmailTemplateSchema, TranslationBundle/Config, ThemeSchema, JobSchema, WebhookSchema, PortalSchema. **Consumers**: email/messaging/i18n/job/webhook services + objectui theme engine.

## 🔴 EmailTemplateSchema — worst drift case
Registered as a live metadata type (`email_template`, `metadata-plugin.zod.ts:106`) **but the entire runtime email path reads a structurally different object** `sys_email_template` (columns `body_html`/`body_text`/`from_name`/`from_address`/`variables_json`/`locale`) — not the spec's `body`/`bodyType`/`variables`. The spec `EmailTemplateSchema` has **zero importers**. Reconcile with `sys_email_template` or delete.

## 🔴 PortalSchema — 100% aspirational
Not registered as a metadata type (no `'portal'` in `metadata-plugin.zod.ts`), no server route wiring (`routePrefix`/`anonymousEntry` have no consumer), no objectui renderer. 326 lines of richly-documented schema with **no consumer** (the file's own header describes consumers as *future*). Every prop DEAD.

## ThemeSchema — `core/theme/ThemeEngine.ts`
LIVE: `name`, `mode`, `colors`, `typography`, `borderRadius`, `shadows`, `animation`, `zIndex`, `customVars`, `extends` (inheritance). **DEAD**: `spacing`, `breakpoints`, `logo` (merged by `mergeThemes` but **never emitted** as CSS vars), `density`, `rtl`, `touchTarget`, `keyboardNavigation`. PARTIAL: `wcagContrast` (`meetsContrastLevel` helper exists but isn't driven by the prop). `label`/`description` display-only.

## TranslationConfig — 5 dead knobs
LIVE: `defaultLocale` (`app-plugin.ts:838`), `fallbackLocale` (i18n adapter). **DEAD**: `supportedLocales`, `messageFormat` (**no ICU engine exists anywhere** — `messageFormat:'icu'` is an unkept promise), `fileOrganization`, `lazyLoad`, `cache`. TranslationData groups (objects/apps/messages) resolve via generic dot-path — convention, not validated keys. HTTP locale fallback uses a heuristic `resolveLocale()`, not the configured `fallbackLocale`.

## JobSchema — `app-plugin.ts:382` → service-job adapters
LIVE: `name`, `schedule` (cron/interval/once: expression/timezone/intervalMs/at), `handler`, `enabled`. **DEAD**: `id`, `label`, `description`, **`retryPolicy`**, **`timeout`** — the cron adapter's `execute()` only try/catch-logs; no retry/backoff/timeout despite the detailed `RetryPolicySchema`.

## WebhookSchema (outbound) — `sys_webhook` + `auto-enqueuer.ts`
LIVE: `name`, `object` (→ row `object_name`, **naming drift**), `triggers`, `url`, `method`, `headers`, `authentication.secret` (HMAC), `timeoutMs`, `isActive` (→ row `active`, **drift**). **DEAD**: `body`, `payloadFields`, `includeSession`, `authentication` (bearer/basic/api-key block — only `secret` read), `retryPolicy` (owned by the outbox), `description`, `tags`. `WebhookReceiverSchema` (inbound) — entirely DEAD.

## Headline
EmailTemplate (live type, dead shape) and Portal (fully aspirational) are the two worst; both should be reconciled-or-deleted. Job `retryPolicy`/`timeout`, Webhook auth (non-HMAC) + `payloadFields`, Theme `spacing`/`breakpoints`, and TranslationConfig `messageFormat`-ICU are richly-specced features with no runtime — classic aspirational config that misleads authors.
