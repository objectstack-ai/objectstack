---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): 「Design layout」's menu adds the app's AI inquiry page, and 「Set as home」 makes it the app's home

Clause-②: no
Metadata-protocol: none

The design mode's menu picker gains 「AI inquiry」, which adds the app's AI inquiry page: a `type: 'component'` navigation entry whose `componentRef` is `ai:chat`. Like 「Link」 it lists nothing. A small form takes the entry's name and the page's copy (heading, subtitle, question-box hint, and up to four suggested questions, one per line); a field left empty keeps the page's default text. The form refuses, under the field, what `AiChatNavParamsSchema` refuses, and cannot be sent until it is mended. An app carries at most one such entry, so the kind is not offered once the app has one, nested in a group included, or when its stored menu holds one the reader is not shown.

That entry's 「⋮」 menu gains 「Edit inquiry page」, which edits the same copy again, and 「Set as home」, which moves the entry to the first place of the top level. The first entry shown is the app's home, so the move is the whole edit: no `landing` is written. An app that declares `landing` keeps landing where it declares.

The entry is saved like every other menu edit: into the app's own package when it is writable, else into its customization package, and published at once. Who sees it is set in Studio, as for every entry. `@object-ui/i18n` carries the new strings in all eleven locales.

Nothing to migrate.
