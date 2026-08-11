---
"@objectstack/service-storage": patch
---

test(service-storage): resolve `@objectstack/core` from source, so a stale dist can no longer decide a pin (#7668)

`packages/services/service-storage` had no `vitest.config.ts`, so its unit suite
resolved `@objectstack/core` through the workspace link to
`packages/core/dist/index.js` — a **build artifact**. The verdict of every unit
pin in the package was therefore a function of build state rather than of the
source in the checkout.

#7668 is what that costs. All 17 cases of `attachment-access-hooks.test.ts` —
the only executable guard on the #4757 predicate-less unscoped-multi-delete
refusal, which cannot be expressed over REST (`deleteMany` with no `ids`/`where`
is rejected with 400 before the hook is reached) — errored with
`TypeError: withoutOperationPrivateKeys is not a function` against a tree whose
prebuilt core predated that export. The source was correct throughout
(`packages/core/src/security/operation-private-keys.ts`), so #4757 was left
unguarded by anything runnable while nothing was actually broken.

The loud error is the mild half. A core dist that is merely **behind** rather
than missing the symbol lets a pin run **green** against core's old behaviour —
a passing test that is not testing the code in the checkout, with nothing in the
output saying so.

**Not a task-ordering bug.** `turbo.json` already declares `test` `dependsOn`
`^build`, and `pnpm turbo run test --filter=@objectstack/service-storage` builds
core first and passes 352/352; it needed no change. The paths that broke are the
ones turbo does not mediate — `pnpm test` inside the package, `vitest run <file>`,
an editor runner, or a QA agent in a tree built at an older commit — and those
are exactly the paths a pin is re-run on while someone is changing core, i.e.
when it most needs to be telling the truth. Ordering cannot fix that; taking the
artifact out of the resolution path can.

A `vitest.config.ts` now aliases `@objectstack/core` to `packages/core/src`,
matching what `service-knowledge`, `plugin-audit`, `runtime`, `metadata` and six
other packages already do. Aliasing is graph-wide, so the dependencies still
loaded from dist (`spec`, `observability`, `platform-objects`, `objectql`)
resolve to the same single core instance rather than a second copy; the shared
tsup config externalizes workspace deps, so none of them inline one. No product
code and no test assertions changed.
