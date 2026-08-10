---
'@objectstack/spec': patch
---

The export-surface pins compare a build-time baseline instead of running `tsc` (#4796).

Seventeen pin tests across thirteen files answered the same question — "which source declaration does entry point X export under name Y?" — and each answered it by building its **own** `ts.createProgram` over all sixteen entry points and running `getTypeChecker()` inside a vitest `it()`. That resolution is now a checked-in artifact, `packages/spec/export-origins/<entry>.json`, and the pins compare against it.

**The cost this removes was measured, not estimated.** On this container the thirteen affected files spent **76.3s** of aggregate test time, of which the seventeen compiler cases were **55.2s** — and the pool grew by one full compilation per retirement PR (the card counted 12 files; there were 18 by the time this was written). It was also non-deterministic in the way that matters: at ~3.4s per case against vitest's 5s default, a loaded merge-queue runner pushed them over the line six times in one night, each time ejecting a PR that had never touched `packages/spec`. Two stop-the-bleed laps raised the timeout (#4856, then #4864); neither saved a millisecond of compilation, because the compilation was never the cause — it was the material.

**A comparison is only as good as the thing compared, so freshness is guarded twice, independently.** `check:export-origins` recomputes from source and compares bytes; it runs inside `check:generated`, hence inside lint.yml's required `TypeScript Type Check` job, so a stale or hand-edited artifact is CI-red. And the pins carry a second guard that needs no compiler at all: every origin whose kind survives to runtime is cross-checked against the entry's real namespace object, so `pnpm test` on its own is not blind to a doctored artifact either. Type-only exports are erased at runtime and are covered by the first guard, which covers everything — two gates that fail for different reasons beat one gate that has to be believed.

**Every pin's claim has a successor that fails under the same condition**, and two of them are strictly tighter rather than equal: the retired pins asserted a declaration's position as `<file>:<line>` with the line matched as `\d+`, i.e. never, so the successors assert the declaring file exactly. The artifact deliberately records no line number — recording one would rewrite it on every edit that shifts a line in any `.zod.ts`, turning a comparison baseline into the repo's next merge-conflict magnet. For the same reason the ten `./contracts` exports that resolve into `ai` / `@ai-sdk/provider-utils` have their pnpm-store version and peer-hash segments normalised away.

Sharded per entry point, following `api-surface/` and for its reason (#5837): retirement PRs rewrite whichever entries they touched, and the merge queue rebuilds server-side where no custom merge driver runs, so two PRs retiring names on different entries must touch disjoint files.

**Two `createProgram` cases are deliberately left as they are.** `data/driver.test.ts` and `ui/app.test.ts` compile a single file to assert that a retired key is *unwritable in the authored type* — a different fact from export origin, which no export-surface baseline can carry. `contracts/sharing-service.test.ts` parses one file with `createSourceFile` to read TSDoc; that is a syntactic parse with no program and no checker, and costs nothing. Naming them here rather than leaving the reader to wonder why `grep typescript` still finds hits.

No runtime or published-surface change: this is a test and tooling change plus one new generated artifact.
