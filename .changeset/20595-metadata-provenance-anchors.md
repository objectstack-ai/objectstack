---
'@objectstack/metadata': patch
---

Provenance comments in `@objectstack/metadata` cite the commits that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each now cites the commit in this repository's history that made the decision it describes, except two
that meant an objectui issue and now spell `objectui#6111`. Some of these
docblocks sit on exported members, so the reworded text appears in the published `index.d.ts` /
`index.d.cts`, `node.d.ts` / `node.d.cts` and `view-container.d.ts` / `view-container.d.cts`, and
comments that esbuild keeps appear in the JavaScript output (`index.js` / `index.cjs`, `node.js` /
`node.cjs`).

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
