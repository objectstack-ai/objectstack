---
'@objectstack/spec': patch
---

Provenance comments in `ui/` were re-anchored

Comment and docblock lines under `src/ui/`, and in
`src/data/filter-subtree-provenance.ts` and
`src/meta-spelling/manifest-collection-spelling.ts`, that cited tracker numbers
which no longer resolve on GitHub now cite the commit in this repository's
history that decided the matter, or the ADR amendment they quote, and say in
their own words what was decided. Two references to objectui numbers now name
objectui on each number. Comments only: no type, schema, export or runtime
behaviour changes.
