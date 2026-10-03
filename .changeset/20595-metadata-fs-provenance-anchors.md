---
'@objectstack/metadata-fs': patch
---

Provenance comments in `@objectstack/metadata-fs` cite the commit that decided them, not a tracker number that no longer resolves

Clause-②: no

Comments and docblocks in the package cited an issue-tracker number that now answers 404 on GitHub.
Each one now cites the commit in this repository's history that made the decision it describes. One of
these docblocks sits on a public method (`FileSystemRepository.close()`), so the reworded text appears in
the published `index.d.ts` / `index.d.cts` and, because esbuild keeps that docblock, in the JavaScript
output (`index.js` / `index.cjs`); the sourcemaps do not change.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
