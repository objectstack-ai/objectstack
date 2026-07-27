---
"@objectstack/plugin-auth": patch
---

fix(auth): spell isLikelyEmail's ASCII guard with printable bounds (no control char)

The non-ASCII guard added in framework#3566 was written as `[^\x00-\x7f]`, whose
regex literal embeds a control character (`\x00`). Rewrite it as `[^\x20-\x7e]` —
identical behaviour (anything outside printable ASCII fails the email
pre-filter), but the pattern no longer carries a control character (eslint
`no-control-regex`), and it matches the objectui side's `isPlausibleEmail`.
