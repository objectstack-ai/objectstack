---
'@objectstack/skills': patch
---

docs(skills): objectstack-formula teaches that a `date` / `datetime` field is its ISO text, so a timestamp-only call takes it through `date()` first

Clause-②: no
Metadata-protocol: none

- **Before.** The Dates table said only "Text in? `isoDate(date(s))`" and never said that a date or datetime field is text, so an agent wrote `isoDate(record.start_at)` or `record.start_date.getFullYear()`, which the authoring gate now refuses as `date-text-call` (#32595).
- **Now.** One note under the Dates table: a `date` / `datetime` field is its ISO text; the build refuses it in a timestamp-only call or method (`date-text-call`); wrap it first, `isoDate(date(record.start_at))`, `date(record.start_date).getFullYear()`; `+` with text and ordering against a text literal take the text as is. One eval prompt expects `isoDate(date(record.start_at))`.
- The note is paid by cuts of sentences the same file states elsewhere; the file gets smaller and no ceiling moves. No schema, key or behaviour changes.
