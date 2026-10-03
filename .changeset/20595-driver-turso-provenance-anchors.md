---
'@objectstack/driver-turso': patch
---

Provenance comments in `@objectstack/driver-turso` cite the commits that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each one now cites the commit in this repository's history that made the decision it describes. Some
of these docblocks sit on exported members, so the reworded text appears in the published `index.d.ts`
/ `index.d.mts`, and the comments esbuild keeps appear in the JavaScript output (`index.js` /
`index.mjs`); the sourcemaps do not change.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
