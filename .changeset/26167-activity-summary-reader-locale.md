---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity summary reads in the reader's language, not the language of the write

Clause-②: no (no exported type, schema field or spec key changes; the code rides in the existing `sys_activity.metadata` JSON, and `summary` keeps its type and meaning)
Metadata-protocol: none

The CRUD mirror now stores two things for each summary: `summary` holds the English sentence, as the fallback text for any reader, search and export, and `metadata.summary_message` holds the message key plus its params (object, record label, field names, from/to values with option values). A new `sys_activity` read middleware composes the summary again in the caller's negotiated locale (from `Accept-Language`, else the workspace locale) with the object, field and option labels of that reader's language pack. A locale with no template, or a code this version cannot compose, keeps the stored sentence. The field redaction still judges the composed text, and the code is served only to system callers.

The write no longer asks for a locale for the summary, so a workspace set to Chinese stores the English sentence: full-text search over `summary` matches the English words. `getLocale` / the localization settings still pick the language of @mention notification titles.

Rows written before this change carry no code: they keep the sentence they were written with, for every reader. There is no migration or backfill, and no row is dropped.
