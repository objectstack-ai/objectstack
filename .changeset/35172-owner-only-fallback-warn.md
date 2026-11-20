---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing): a hierarchy scope that falls back to owner-only for want of a resolver now says so once per boot

Clause-②: no
Metadata-protocol: none

When a permission set grants a hierarchy scope (`own_and_reports`, `unit`, `unit_and_below`) and no `hierarchy-scope-resolver` service is registered (the `hierarchy-security` capability, provided by `@objectstack/security-enterprise`), the sharing layer fails closed to owner-only. It used to do so without a word, so a runtime booted without the CLI gave an operator nothing to explain why every user saw only their own records.

- The first time the fallback is taken, the sharing service logs one `warn` naming the capability, its provider and the owner-only consequence. It is logged once per service instance, which is once per boot, never once per request.
- Nothing is logged for an app that never asks for a hierarchy scope, or when a resolver is registered.
- The answer does not change: the scope still resolves to the caller alone.
