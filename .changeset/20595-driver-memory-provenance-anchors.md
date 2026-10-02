---
'@objectstack/driver-memory': patch
---

Provenance comments in `@objectstack/driver-memory` cite the commits that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each one now cites the commit in this repository's history that made the decision it describes. Some of
these docblocks sit on exported members, so the reworded text appears in the published `index.d.ts` /
`index.d.mts`, and comments that esbuild keeps appear in the JavaScript output.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
