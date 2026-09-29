---
'@objectstack/spec': patch
---

Provenance comments in `stack.zod.ts` and `data/analytics.zod.ts` were re-anchored

Twelve comment and docblock lines in `src/stack.zod.ts` and
`src/data/analytics.zod.ts` cited tracker numbers that no longer resolve on
GitHub. They now cite the commit in this repository's history that decided
the matter: the `themes` carrier retirement, the lowered-handler array form of
`functions`, the closed `ManifestSchema`, the same-key action refusal in
`defineStack` and its cross-stack twin in `composeStacks`, and the
`analytics_cube` binding at the `/meta` write door. Comments only: no type,
schema, export, `describe()` text or runtime behaviour changes.
