---
'@objectstack/rest': patch
---

fix(rest): a boolean cell in the list export is written in the caller's language (#24945)

Clause-②: no

`GET /api/v1/data/:object/export` (Display → Export as CSV / XLSX / JSON) wrote every boolean or toggle cell as `是` or `否`, whatever the caller read. The header row of the same file follows the caller's locale, so an English caller got "Converted" and "Do Not Call" over Chinese cells.

- **Now.** A boolean or toggle cell is written in the words the import template already uses for the caller's locale: `yes` / `no`, or `是` / `否` for a `zh*` locale. The locale is the one the header row is translated to: `Accept-Language`, then `?locale=`, then the deployment's default locale. The header and the cells always read one language. This applies to csv, xlsx and json.
- **No locale at all.** When the request names no locale and the deployment declares no default, the cells read `yes` / `no`, the same words the import template writes then.
- **Re-import.** A file exported in either language re-imports its boolean column: the importer reads `yes` / `no` and `是` / `否`.
- **Unchanged.** No query parameter, header, column set or payload shape moves. Only the text of a boolean cell changes, and a Chinese caller's file is byte-for-byte what it was.
