---
'@objectstack/spec': patch
---

Provenance comments in `conversions/registry.ts` and `integration/connector.zod.ts` were re-anchored

Clause-②: no

Thirteen comment and docblock sites in `src/conversions/registry.ts` and
`src/integration/connector.zod.ts` cited tracker numbers that no longer resolve on
GitHub. They now cite the record that decided the matter: ADR-0087's 2026-09-13
addendum for the data-at-rest seams `retiredFromLoadPath` does not hold back, and
otherwise the commit in this repository's history. Comments only: no type, schema,
export, `describe()` text, conversion `summary` or runtime behaviour changes.
