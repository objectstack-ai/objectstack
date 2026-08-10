---
'@objectstack/rest': patch
---

`/meta` reads localize the canonical PLURAL spelling, not just the singular

The three metadata read handlers (`GET /meta/:type`, `GET /meta/:type/:name`,
`GET /meta/:type/:section/:name`) handed the raw `:type` path segment to the
translate helpers, whose "does this type translate" predicate reads a set derived
from singular-only translator keys (`view` / `action` / `object` / `app` /
`dashboard` / `page`). Prime Directive #3 makes plural the canonical REST
spelling, so a caller following the documentation received unlocalized
labels/descriptions/navigation while the singular spelling of the same route
returned the translated document.

`translateMetaItem` / `translateMetaItems` now fold the spelling to the canonical
singular before asking, so both spellings answer the same localized body. The set
of translatable types is unchanged — only which spellings reach it.
