---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(i18n): the Console language menu offers the platform locale table's languages, intersected with the app's locale list

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata an author writes changes: `i18n.supportedLocales` accepts the same values, `GET /api/v1/i18n/locales` reports the same list and no stored shape is rewritten; what narrows is the Console menu's reading of that list, and a language outside the platform locale table has no replacement spelling to migrate to -->

**BREAKING** for an app whose locale list names a language outside the platform locale table (for example `th`): the Console language menu no longer offers it. No first-party app does — examples/app-crm, app-showcase, app-todo and HotCRM declare only table languages, through read-alias spellings that now show as their table entries.

The Console language menu now offers the platform locale table's languages,
intersected with the app's locale list (ruling F). `offerableLanguages` reads
each code the app lists through the table's read aliases and offers table tags
only, de-duplicated, in the app's order:

- a stored spelling is its table entry with the table's own label: an app
  declaring `zh-CN`, `ja-JP` or `es-ES` shows 简体中文, 日本語 and Español instead
  of 中文（中国）, 日本語 (日本) and Español de España, and a pick writes the
  table tag (`zh-Hans`) to `sys_user.locale`;
- two spellings of one language (`zh-CN` beside `zh-Hans`) are one entry;
- a code the table does not name (for example `th`) is no longer offered, and
  neither is an out-of-table key of `config.resources` in the offline fallback.
  A stored choice of such a code still boots, then reverts and is cleared once
  the app's list arrives.

The menu's checkmark and the profile page's language card compare a stored
spelling through the same resolution, so an account storing `zh-CN` sees one
简体中文 entry, ticked.

Migration: none for a metadata author — `i18n.supportedLocales` accepts the
same values and `GET /api/v1/i18n/locales` reports the same list. An app that
relied on the menu offering a language outside the platform locale table has
no replacement; that language is not complete on the platform's own surfaces.
