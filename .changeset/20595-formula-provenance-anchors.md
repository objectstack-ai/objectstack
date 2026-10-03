---
'@objectstack/formula': patch
---

Provenance comments in `@objectstack/formula` cite the commit that decided them, not a tracker number that no longer resolves

Clause-②: no

Comments and docblocks in the package cited an issue-tracker number that now answers 404 on GitHub.
Each one now cites the commit in this repository's history that made the decision it describes. One of
these docblocks sits on an exported member (`SCOPE_ROOTS`), so the reworded text appears in the
published `index.d.ts` / `index.d.mts`; one comment esbuild keeps inside that list appears in the
JavaScript output (`index.js` / `index.mjs`); the sourcemaps do not change.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
