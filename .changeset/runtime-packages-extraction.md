---
"@objectstack/runtime": minor
---

feat(runtime): extract the /packages dispatcher domain body — ADR-0076 D11 step ③, PR-5 (#2462)

The largest domain so far (~680 lines: the handler plus its two exclusive
helpers `assemblePackageManifest` and `applyPublishedSeeds`) moves to
`domains/packages.ts` — list/install/enable/disable, ADR-0033 draft
publish/discard, ADR-0067 commit history & rollback, ADR-0070 export /
orphan adoption / duplicate, delete. `DomainHandlerDeps` grows the shared
facilities the body needs: `errorFromThrown` (field-anchored 422s),
`resolveActiveOrganizationId` (session org), `announceKernelEvent`
(`metadata:reloaded` after publish), and an optional `logger`. The step-②
(#3142) single-pipeline behavior is preserved. Zero behavior change —
http-conformance (41) plus 4 new seam tests (incl. the 409
duplicate-install guard).
