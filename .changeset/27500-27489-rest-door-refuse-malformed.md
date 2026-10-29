---
'@objectstack/rest': patch
---

fix(rest)!: the export door refuses an unserved `format`, and the clone door refuses a non-object `overrides`, instead of answering as if they were not sent (#27500, #27489)

Clause-②: no (narrowing) — `GET /data/:object/export` refuses a `format` outside csv, json and xlsx, and `POST /data/:object/:id/clone` refuses an `overrides` (or bare body) that is not a JSON object; both used to answer success with the value ignored. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: two REST doors now refuse request values they used to ignore. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at two REST data doors (`@objectstack/rest`).

- **Export, before.** Any `format` other than `json` or `xlsx` was answered as csv: `?format=pdf`, `?format=xml` and `?format=` (empty) answered `200` with a csv attachment and `X-Export-Format: csv`.
- **Export, now.** A present `format` must be `csv`, `json` or `xlsx` (case-insensitive, surrounding blanks trimmed). Anything else, the empty value included, answers `400` with `error.code: 'VALIDATION_ERROR'`, naming the value and the served set, before any row is read. The spec's `ExportFormat` enum lists more values (for example `jsonl`, `parquet`); this route never served them and refuses them too.
- **Clone, before.** `{"overrides": "x"}` (or a number, `true`, `null`) was dropped and the door answered `201` with a plain copy; an array reached the clone and was merged index-wise. A bare array or string body behaved the same way.
- **Clone, now.** A nested `overrides`, or a bare body, that is not a JSON object answers `400` with `error.code: 'VALIDATION_ERROR'`, naming `overrides`, before the clone runs. `"overrides": null` is refused, not read as absent.
- **Unchanged.** An absent `format` is csv. An object `overrides`, a bare field map, `{}`, and no body at all clone exactly as before. The SDK's `data.clone` and `data.export` send only accepted shapes.
- **Who sees it.** An API caller or script that sends an unserved export format, or a clone body whose `overrides` is not an object. Such a request used to succeed while meaning something other than what was sent.

**The remedy.** Export: send `csv`, `json` or `xlsx`, or omit `format` for csv. Clone: send `overrides` as an object of field values, or omit it (or send no body) for a plain copy.
