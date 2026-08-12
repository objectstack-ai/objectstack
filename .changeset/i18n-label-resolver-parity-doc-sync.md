---
"@objectstack/spec": patch
---

docs(spec): sync `resolveI18nLabel`'s reference fixture and module doc to objectui's post-#3907 `pickLocalized` (#7864)

`resolveI18nLabel` (`packages/spec/src/ui/i18n-label-resolver.ts`) documented
two deliberate narrowings of its reference, objectui's `pickLocalized`: own-
property-only reads and a `string` filter on every limb. objectui PR #4359
(objectui#3907) landed both guards upstream, so the rule departures are now
zero — this is a documentation and test-fixture sync, not a behavior change to
`resolveI18nLabel` itself.

- The module doc's "Rule departures" section is reworded to record the
  convergence and the two differences that survive it: the miss spelling
  (`''` vs `undefined`) and the top-level scalar pass-through (`pickLocalized`
  stringifies a bare number/boolean; `resolveI18nLabel`'s declared parameter
  type refuses one). This prose reaches `dist/**/*.d.ts`.
- `i18n-label-resolver.test.ts`'s verbatim reference copy is refreshed to
  objectui `origin/main d8d0d66` / blob `30fcb0a8`, its two stale assertions
  are flipped to the converged answers (a guard makes its limb MISS, it does
  not abort resolution), and the 18-vector CONVERGED table mirrored from
  objectui's `plugin-list/src/__tests__/i18nLabel-resolver-parity.test.ts` is
  added as an acceptance fixture.
