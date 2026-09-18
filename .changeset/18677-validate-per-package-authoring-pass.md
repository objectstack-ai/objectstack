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

**Severity mapping is `os build`'s, unchanged.** A per-package `error` refuses (exit 1); an advisory joins `warnings`. So `os validate` is narrowed only to the bar the command that *ships* already holds: every input it can now refuse is one `os build` already refuses.

**BREAKING** — `os validate --strict` can now fail a project it passed before. Measured on a two-package fixture whose union fold is clean and whose per-package run is not (`core` owns `pp_account`; a sibling package owns the view that displays `pp_account.industry`), driving the CLI from source:

| `os validate` on that fixture | before | after |
|---|---|---|
| `--json` | warnings 0, exit 0 | warnings 1, exit 0 |
| `--json --strict` | exit 0 | **exit 1** |

The one warning is `field-no-consumers` at `package 'com.example.ppflip.core' — object "pp_account" · field "industry"`, which `os build` already reports on the same fixture: nothing is refused here that `os build` does not already refuse, and the default (non-strict) face is unchanged in that measurement. A run that must keep its old verdict drops `--strict`; a project that wants to keep the flag fixes what the per-package pass reports, which is what `os build` has been reporting all along.

Why the union fold does not see it: `packageBodyAsStack` hands each package the artifact's whole `packages[]` as resolution context, so a cross-package *reference* still resolves and the reference-integrity rules stay quiet — but a reachability rule asks what the **stack** reads, and per package the stack is that one package's own body. A field whose only consumer lives in a sibling package is therefore live to the union run and inert to the per-package run, and that is the shape that reaches `--strict`.

Graded `minor` rather than `patch` for the new observable step line, the new advisories and the newly reachable non-zero exit; the launch window refuses `major`, so the breaking-ness is carried by the banner above and the ADR-0087 disposition below.

Unchanged and out of scope: the ADR-0130 D4 union fold (#17069, fixed — `authoringRuleUnionStack` is in both commands), `--json` rendering (#11727), and disagreements *within* the per-package pass's verdicts (#18204). `os lint` still runs the union pass alone; its `artifactPackages` / `packageBodyAsStack` imports serve its own intra-package duplicate-name advisory, not the shared table.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes changes: no spec key, export, config field or payload key is removed, renamed or added. What moved is which stacks one CLI command's existing rule table is run over, so `objectstack migrate meta` has nothing to rewrite and the ledger has nothing to record. -->
