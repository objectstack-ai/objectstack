---
"@objectstack/metadata-protocol": patch
"@objectstack/rest": patch
---

fix(data): a filter the server cannot apply is rejected, not silently ignored (#4181)

`GET /api/v1/data/:object?filter={status:done` — one missing quote — answered
`200` with the **unfiltered** page. The JSON-parse tolerance
(`catch { /* keep as-is */ }`) left the raw string on `where`, a shape no
driver consumes, so the filter was dropped whole and the response was
byte-for-byte a successful unfiltered query. The worst failure direction in
this family: #4134 returned nothing, #4164 dropped one predicate, this
returned everything.

The sibling `GET /data/:object/export` route had rejected the same input since
it was written (`400 INVALID_REQUEST`, "filter must be JSON") — the list path
was the outlier. That guard now lives in the shared normalizer, so
`GET /data/:object`, `POST /data/:object/query` and the runtime dispatcher all
give one answer:

- Unparseable JSON → `400 INVALID_REQUEST`, naming the parameter and stating
  the filter was not applied.
- Parses but is not a filter (`?filter=5`, `?filter="done"`, `?filter=null`) →
  same rejection; usable JSON is not a usable filter.
- Blank `?filter=` → treated as absent, as before. No error.
- `filter` / `filters` / `$filter` / `where` are four spellings of ONE slot.
  Sending two with **different** values used to run one and discard the rest
  silently; it is now `400 INVALID_REQUEST`. Redundant identical spellings pass.
- `orderby` on the export route gets the same treatment — a sort that cannot be
  parsed is refused rather than dropped (lower stakes than a filter: the row set
  is unchanged, but a caller taking "latest N" got an arbitrary N).

**What changes for callers:** requests carrying a malformed filter now fail
loudly instead of receiving every record. Every valid filter shape — JSON
string, live object, `FilterCondition` AST array, and all four alias spellings
used alone — is unaffected.
