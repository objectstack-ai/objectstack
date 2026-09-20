---
'@objectstack/cli': minor
---

`os validate` runs the per-package author-time rule pass `os build` already ran — the false-clean residue #17069 left one layer down.

`os build` runs the artifact's authoring rules **twice**: once over the union-folded stack, then a second `runAuthoringRules('build', …)` pass over each `artifactPackages(…)` entry with `packageBodyAsStack(…)` as resolution context, de-duplicated against the union run. `os validate` ran the union pass and stopped — it imported neither seam. By `compile.ts`' own description the survivors of that second pass are "exactly the set the union could not see", so that whole set was findings `os build` reported and `os validate` **structurally could not**. The direction is false-clean, and on the worse door: the fast pre-flight is what an author runs *before* shipping, so its clean bill of health is the strongest false assurance the three commands can give.

Measured on `origin/main` 09e16a574 over `examples/app-multi-package`, both commands exiting 0:

```
os build    --json  warnings: 4      <- 3 union + 1 per-package survivor
os validate --json  warnings: 3      <- the survivor is the defect
```

After: both report 4, the same set, in the same order.

**The loop is now one seam, not two copies.** `runPerPackageAuthoringRules` lives beside `artifactPackages` / `packageBodyAsStack` in `utils/artifact-packages.ts`, whose header already forbids a second copy of that shape by name. What would have drifted between two hand-written loops is not the package reading but the **verdict** — the de-duplication key, the severity split, the `where` prefix. `os build`'s observable output is unchanged (text face byte-identical modulo timings; `--json` payload identical).

**Severity mapping is `os build`'s, unchanged.** A per-package `error` refuses (exit 1); an advisory joins `warnings`. So `os validate` is narrowed only to the bar the command that *ships* already holds: every input it can now refuse is one `os build` already refuses, which means **nothing that builds today stops validating**. No newly-refused input could be exhibited on any fixture — across the repo's own two-package example and three constructed variants the observable change is advisory-only, because `packageBodyAsStack` hands each package the artifact's whole `packages[]` as resolution context and the reference-integrity suite resolves object names through it. Graded `minor` rather than `patch` for the new observable step line, the new advisories and the newly reachable non-zero exit; ⛔ **not** declared breaking, because the narrowing could not be exhibited and is bounded by an existing gate.

Unchanged and out of scope: the ADR-0130 D4 union fold (#17069, fixed — `authoringRuleUnionStack` is in both commands), `--json` rendering (#11727), and disagreements *within* the per-package pass's verdicts (#18204). `os lint` still runs the union pass alone; its `artifactPackages` / `packageBodyAsStack` imports serve its own intra-package duplicate-name advisory, not the shared table.
