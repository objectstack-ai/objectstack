---
'@objectstack/metadata-core': patch
---

Provenance comments in `@objectstack/metadata-core` cite the commits that decided them, not tracker numbers that no longer resolve

Clause-②: no

Docblocks and comments across the package cited issue-tracker numbers that now answer 404 on GitHub.
Each now cites the commit in this repository's history that made the decision it describes, with two
exceptions: two comments on `retiredFromLoadPath`'s jurisdiction (in `artifact-forward-conversion.ts`
and its test) cite ADR-0087, which records that determination, and five comments that meant an
objectui issue now spell it `objectui#6111`, as they already spelled `objectui#6110` beside it. One
commit citation sits inside a maintainer ruling quoted in `record-organization.ts`: the number there
became the bracketed editorial substitution `[commit 7901b2dd2]`, the commit that landed the ruling it
names, and the rest of the quotation is unchanged. Some of these docblocks sit on exported members, so
the reworded text appears in the published declaration files (`index.d.ts` / `index.d.cts`,
`testing.d.ts` and a shared declaration chunk); the JavaScript output and its sourcemaps do not change.

Comment only: no export, type, error code, status, message text or runtime behaviour changes.
