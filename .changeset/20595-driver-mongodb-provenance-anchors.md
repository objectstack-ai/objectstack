---
'@objectstack/driver-mongodb': patch
---

Provenance comments in `@objectstack/driver-mongodb` cite the commits that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each one now cites the commit in this repository's history that made the decision it describes. One of
these docblocks sits on an exported member (`MongoDBDriver.update()`), so the reworded text appears in
the published `index.d.ts` / `index.d.mts`; that docblock and one more comment esbuild keeps appear in
the JavaScript output (`index.js` / `index.mjs`); the sourcemaps do not change.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
