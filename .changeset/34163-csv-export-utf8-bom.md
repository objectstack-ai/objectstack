---
'@objectstack/rest': patch
---

fix(rest): a csv export opens with the UTF-8 byte-order mark, so Excel reads non-ASCII headers and cells correctly

Clause-②: no
Metadata-protocol: none (no authorable key or value; the CSV export body gains a leading UTF-8 byte-order mark. The dev confirms against the diff.)

`GET /api/v1/data/:object/export?format=csv` (the default format) now writes the UTF-8 byte-order mark (U+FEFF, the bytes `EF BB BF`) once, in front of the first thing in the body: the header row, the first data row under `header=false`, or the header row alone when an export with an explicit `fields=` or a readable projection has no rows. An export that writes nothing at all stays a zero-byte file.

Before, the answer carried `Content-Type: text/csv; charset=utf-8`, but that charset does not travel with the saved file. Excel on Windows and on Mac opens a csv without the mark in the system ANSI code page, so every Chinese, Japanese or accented header and cell came out garbled, while the xlsx export of the same list opened correctly.

The headers (`Content-Type`, `Content-Disposition`, `X-Export-*`) are unchanged, and there is no new query parameter. `format=json` and `format=xlsx` carry no mark. The csv import already strips one leading mark, so an exported file re-imports unchanged.

A client that compares the export body byte for byte, or splits it as text without a decoder that drops the mark, sees U+FEFF at the start of the first cell. `Response.text()` and other WHATWG UTF-8 decoders drop it; read the body as bytes, or strip one leading U+FEFF, to compare.
