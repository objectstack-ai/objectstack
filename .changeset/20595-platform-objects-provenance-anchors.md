---
'@objectstack/platform-objects': patch
---

Provenance comments in `@objectstack/platform-objects` cite the commits that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each now cites the commit in this repository's history that made the decision it describes, except one
that cites ADR-0104's 2026-09-05 addendum, the record of that ruling. Some of these docblocks sit on
exported members, so the reworded text appears in the published declaration files (`apps`, `identity`,
`metadata-translations` and `system` `index.d.ts` / `index.d.mts`), and the field comments esbuild keeps
appear in the JavaScript output (`index`, `apps`, `audit`, `identity` and `plugin`, `.js` / `.mjs`).

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
