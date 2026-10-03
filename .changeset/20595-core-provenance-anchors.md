---
'@objectstack/core': patch
---

Provenance comments in `@objectstack/core` cite the commits that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each now cites the commit in this repository's history that made the decision it describes, except two
comments on the unpack-time integrity re-verification leg, which pointed at a tracker for work that was
never built and now say in words that the leg is unbuilt. Some of these docblocks sit on exported
members, so the reworded text appears in the published declaration files (`index.d.ts` /
`index.d.cts`), and the comments esbuild keeps appear in the JavaScript output (`index.js` /
`index.cjs`).

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
