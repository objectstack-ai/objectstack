---
'@objectstack/rest': patch
---

fix(rest): a refused `GET /data/:object/export?format=xlsx` answers the 400 envelope, not a 200 workbook stream

Clause-②: no
Metadata-protocol: none

The xlsx export opened its streaming workbook writer before its first read. Opening the writer commits the response to a streaming 200, so a query that read refused (for example `?search=x&searchFields=nope`, a search over a field the object does not have) reached the client as a 200 workbook download, while `format=csv` and `format=json` answered the 400 envelope.

- **Read first.** The workbook writer now opens after the first page is read, as the csv and json exports write their first byte. A refusal on that read answers the same status and body as the csv export.
- **A successful export is unchanged.** One page, several pages and no rows produce the same status, headers and workbook cells.
- A refusal on a later page, after rows have been written, still ends the stream; that is not changed here.
