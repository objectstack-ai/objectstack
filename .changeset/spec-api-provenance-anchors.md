---
'@objectstack/spec': patch
---

Provenance comments in `api/` were re-anchored

Comment and docblock lines under `src/api` (all but `rest-server.zod.ts`) that
cited tracker numbers which no longer resolve on GitHub now cite the commit in
this repository's history that decided the matter, and say in their own words
what was decided. Comments only: no type, schema, export or runtime behaviour
changes.
