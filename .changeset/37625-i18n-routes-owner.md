---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills,spec): the i18n skill and two spec comments name the dispatcher as the owner of the `/api/v1/i18n/*` routes

Clause-②: no (published prose and comments only; no behaviour changes)
Metadata-protocol: none

`skills/objectstack-i18n/SKILL.md` (Registration) said the i18n service "self-registers" `GET /api/v1/i18n/locales`, `/translations/:locale` and `/labels/:object/:locale`. On `main` `I18nServicePlugin` mounts no HTTP route (retired by #23347); the runtime's HTTP dispatcher, which `os serve` composes, mounts the three paths and serves them from the i18n service. The sentence now says so, and the methods list gains `getSourceLocale()` / `setSourceLocale()`, which both shipped implementations provide (`getFallbackLocale()` is left out: the in-memory fallback deliberately has none). The words are paid for by tightening four phrasings in the same file; no fact is removed. The `GetLocalesResponseSchema` docblock (`packages/spec/src/api/protocol.zod.ts`) and the `toLocaleDescriptors` comment (`packages/spec/src/system/i18n-resolver.ts`) make the same correction.
