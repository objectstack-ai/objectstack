---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a metadata create form states identifier errors in the reader's language, and its summary banner wraps them

Clause-②: yes (widening)
Metadata-protocol: none

A Chinese-language administrator who gave a new permission set (or any metadata item whose name is a snake_case identifier) an all-Chinese label was told in English, in the banner above the form, that Name "must be at least 2 characters" and "must be lowercase snake_case …", and the second sentence was cut off with an ellipsis on a narrow window.

The banner and the inline field errors now pick the text by what the schema issue is (its code, and for a pattern its regex), never by reading the English: in Chinese they read 至少需要 2 个字符 and the snake_case rule in Chinese. In English they still show the sentences `@objectstack/spec` wrote, which do not change. The banner's lines now wrap instead of being truncated.

`@object-ui/i18n`'s `studio` namespace gains the zh-only `engine.validation.spec.*` rows (`stringTooShort`, `snakeCaseIdentifier`, `systemIdentifier`); English has no row on purpose and falls back to the spec's message. `SchemaFormIssue` gains an optional `detail` (the issue's code and parameters).
