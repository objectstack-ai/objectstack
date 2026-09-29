---
'@objectstack/runtime': patch
---

Provenance comments in `@objectstack/runtime`'s `/meta` dispatcher domain were re-anchored

Comment and docblock lines in `src/domains/meta.ts` that cited tracker numbers
which no longer resolve on GitHub now cite the commit in this repository's
history that decided the matter, and say in their own words what was decided.
Comments only: no route, error code, refusal text, type, export or runtime
behaviour changes.
