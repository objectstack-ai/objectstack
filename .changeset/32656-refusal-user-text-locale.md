---
'@objectstack/plugin-security': patch
'@objectstack/metadata-protocol': patch
---

fix(plugin-security): permission refusals speak the caller's language, falling back to the workspace default

Clause-②: no
Metadata-protocol: none

Ruling C on #32440, second half of #32656: a refusal's user-facing sentence is composed in the request's language, else the workspace's default language, else English. Codes, statuses and the diagnostic `message` are unchanged.

- **Packaged permission-set lock.** Saving a permission set an installed package provides, and the fail-closed refusal when the system cannot tell, used to answer their `userMessage` in English only. They now answer in the caller's language (English, Simplified and Traditional Chinese, Japanese, Korean, Spanish, French, German, Brazilian Portuguese, Russian and Arabic). The metadata write door hands each type's authoring gate the caller's two languages (`MetadataAuthoringGateContext.userTextLocales`); a caller that states none gets English, as before.
- **Permission denials.** The record, field, owner and queue denials of the security middleware were rendered in the request's language only, so a request in a language the platform has no text in fell to English even when the workspace default had text. They now fall back to the workspace default first. A deployment's `errors.<key>` translation override counts as text for its language.
