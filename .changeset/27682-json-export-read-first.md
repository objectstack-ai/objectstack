---
'@objectstack/rest': patch
---

fix(rest): a refused `GET /data/:object/export?format=json` answers the 400 envelope, not a truncated 200 stream

Clause-②: no
Metadata-protocol: none

The json export wrote its opening `[` before its first read. The first write commits the response to a streaming 200, so a query that read refused (for example `?search=x&searchFields=nope`, a search over a field the object does not have) reached the client as a 200 whose body was a lone `[`, while `format=csv` answered the 400 envelope.

- **Read first.** The bracket is now written after the first page is read, as csv writes its first byte. A refusal on that read answers the same status and body as the csv export.
- **A successful export is unchanged.** One page, several pages and no rows produce byte-identical bodies and the same headers.
- A refusal on a later page, after rows have been written, still ends the stream; that is not changed here.
