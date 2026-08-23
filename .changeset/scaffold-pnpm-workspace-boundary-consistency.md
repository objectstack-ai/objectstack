---
"create-objectstack": patch
---

Correct the pnpm boundary the blank template states for `allowBuilds`, and gate
the two scaffold paths against each other (#10498, #10499).

`packages/create-objectstack/src/templates/blank/pnpm-workspace.yaml` is copied
verbatim into every scaffolded project, so its header comment is prose that
ships **inside the user's own repository**. It said `allowBuilds` needs
pnpm >= 10.31 and that `onlyBuiltDependencies` covers pnpm 10.0–10.30. Measured
on a probe depending on `esbuild@0.28.2`, with a workspace file carrying only
`allowBuilds`, one clean install per pnpm version and each with its own
`--store-dir` (isolation matters — pnpm's side-effects cache will otherwise hand
a later run a build an earlier run performed, and it reads as "the key worked"):

| pnpm | `allowBuilds` alone |
|:--|:--|
| 10.15.0 – 10.25.0 | ignored — build not run |
| **10.26.0** | **honoured — build ran** |
| 10.28.0 – 10.33.0 | honoured — build ran |

So the floor is 10.26.0 and the older-key band is 10.0–10.25. A user on pnpm
10.28 was being told by the file in front of them that their pnpm cannot read
the key it is in fact reading. Both load-bearing claims in that comment were
correct and are unchanged: both keys are needed, and pnpm 11 reads only
`allowBuilds`. No setting, no assertion and no install behaviour changes — the
rendered `onlyBuiltDependencies` / `allowBuilds` values are byte-identical.

The reason it was wrong for so long is the second half of this change.
`objectstack init` renders the same file from `renderPnpmWorkspaceYaml()` in
`packages/cli`, it was corrected to the measured numbers separately, and each
package's ratchets are package-local — so neither could ever fail for the other
file's regression, and the two scaffold paths shipped contradictory prose about
the same rule with every gate green. `packages/cli/test/scaffold-workspace-consistency.test.ts`
now compares the two **rendered outputs**: the packages each key actually grants
a build to, and the pnpm versions each file actually names for each key. It was
confirmed failing against the live divergence before this correction landed.

Bumped `patch` rather than left out: the corrected text is user-visible — it is
delivered into every new project — while nothing executable moves.
