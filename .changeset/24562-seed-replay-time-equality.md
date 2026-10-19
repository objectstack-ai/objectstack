---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a seed replay no longer rewrites an unchanged row whose `time`, `datetime` or `date` value the seed spells differently from the stored form (#24562)

Clause-②: no

The replay's no-op check (`isNoOpReplay`) compared a seed value with the stored one as text, so `'09:15'` against the stored `'09:15:00'`, `'2026-06-17T14:30:00Z'` against `'2026-06-17T14:30:00.000Z'`, and a `date` written as an instant against its stored `YYYY-MM-DD` all read as changed. Every boot rewrote those rows: `updated_at` moved, lifecycle validation ran again, history tracking recorded an edit nobody made, and a parent's summary recompute moved the parent's `updated_at` too.

A field the object declares `time`, `datetime` or `date` is now compared in its stored form, by the rule the drivers apply on write (`temporalStorageForm`, `@objectstack/core`). Two spellings of the same wall clock, instant or calendar day skip the row. A different value is still rewritten, and a value that rule cannot read still counts as changed. What a seed may declare, and what any write stores, is unchanged.
