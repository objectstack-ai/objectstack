---
'@objectstack/cli': patch
---

fix(cli): i18n coverage reads a two-script inline label map the way the renderer does

Clause-②: no
Metadata-protocol: none

For an inline locale map that carries both Chinese scripts, the text the coverage report reads for a reader locale now equals what the renderer shows: a `zh-Hant` reader of `{ en, 'zh-CN', 'zh-TW' }` is read from `zh-TW`, not from the first `zh-*` key. Every other map and language reads as before.
