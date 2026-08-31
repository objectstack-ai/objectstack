---
"@objectstack/cli": patch
---

refactor(cli): `i18n-extract`'s per-component pass consumes `@objectstack/spec`'s `walkAddressedPageComponents` instead of hand-mirroring it (#13218)

Behaviour is unchanged — same entries, same order. The five traversal
invariants the pass used to restate (roots, descent key, depth cap, cycle
guard, ruled collision arbitration) now have a single source in
`packages/spec`, so a future change there carries the extractor along
structurally instead of relying on someone remembering a file in another
package. What stays local is what is genuinely the extractor's own: the
region-level `page:header` emission exception and the `label` either/or. The
40-deep differential in `test/platform-page-i18n-parity.test.ts` is preserved
as the convergence's regression guard.
