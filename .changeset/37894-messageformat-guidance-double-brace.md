---
'@objectstack/spec': patch
---

fix(spec): the retired `messageFormat` key's refusal names the placeholder the server fills, `{{variable}}`

Clause-②: no
Metadata-protocol: none

An i18n configuration that still sets `messageFormat` is refused with a sentence telling the author that interpolation is simple `{variable}` substitution. Neither server `t()` path fills that spelling: the i18n service's file adapter and the kernel's in-memory fallback both replace `{{variable}}` only, and print a single-brace `{variable}` as written. The console's i18next bundles use double braces too. An author who followed the refusal shipped messages that showed `{name}` literally.

The refusal, and the `TranslationConfigSchema` docblock, now say that a message read through `t()` is filled by `{{variable}}`, that a single-brace `{variable}` is left as written there, and that activity-milestone summaries keep their own `{field}` tokens. `messageFormat` is refused exactly as before; only the sentence changes. Nothing to migrate: a bundle that already uses `{{variable}}` is unaffected, and one written to the old advice should change `{name}` to `{{name}}`.
