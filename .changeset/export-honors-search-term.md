---
"@objectstack/rest": patch
---

fix(rest): `GET /data/:object/export` honours a `search` term

The streaming export route accepted `filter` and `orderby` but had no way to
carry the term a user had typed into the list's search box. So exporting after
a search downloaded the **unsearched superset** — more rows than the screen
showed, in a file that looks authoritative, with nothing indicating the
difference. The route's own comment claimed the opposite: that it "mirrors the
active view's filter + sort so the exported file matches what the user sees".

Same family as a dropped filter (objectstack#3948, objectstack#4181): a
plausible answer that is quietly broader than the one asked for.

Two new query params, both matching the list endpoint's semantics:

- `search=<term>` — folded into `findData` as `$search`, so it **composes**
  with `filter` (`{ $and: [filter, search] }`) rather than replacing it. Empty
  or whitespace-only terms are ignored rather than applied as a blank predicate.
- `searchFields=a,b` — the ADR-0061 override for which fields the term scans.
  Only meaningful alongside `search`, and intersected with the object's allowed
  searchable set by the engine, exactly as on the list endpoint.

Unknown query params on this route were already ignored, so a client that sends
`search` to an older server gets today's behaviour rather than an error.

Covered by `export-integration.test.ts` against the real engine + protocol: the
composition case is built so each half alone returns a different non-empty
result and only "both applied" returns none. Reverting the route change fails 4
of the tests. The file's in-memory driver also learned `$or` / `$contains` —
without them a search predicate is a silent no-op and an "it filtered"
assertion would pass for the wrong reason.
