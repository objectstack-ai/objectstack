---
'@objectstack/objectql': patch
---

Provenance comments in `@objectstack/objectql` cite the commits and ADRs that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each one now cites the commit in this repository's history that made the decision it describes, or the
ADR that records it (ADR-0029 D9.2a, ADR-0104's 2026-09-05 addendum, ADR-0126 §7.2, ADR-0130 D3).
Some of these docblocks sit on exported members, so the reworded text appears in the published
`index.d.ts` / `index.d.mts`, `core.d.ts` / `core.d.mts` and the shared type chunk, and comments that
esbuild keeps appear in the JavaScript output.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
