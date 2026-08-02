---
---

ci: close issues that a merged PR fixes in another repository (#4482 follow-up)

Release-nothing: adds `.github/workflows/cross-repo-issue-closer.yml` and no
package code.

GitHub's closing keywords only act within a repository, so a PR here saying
`Fixes objectstack-ai/objectui#456` merges and leaves that issue open — and the
issue's own page carries no reference to the PR that fixed it, so the next
reader cannot find the fix either. v17 verification (#4482) hit this twice in
one day; #4475 and #4478 were both closed by hand.

The job has two modes and both are visible. With a cross-repo token it closes
the foreign issue and links the PR. Without one it comments on the merged PR
naming what still needs closing by hand — because the repository's only secrets
are `GITHUB_TOKEN` (scoped to the repository running the workflow, which is the
whole problem) and `NPM_TOKEN`, so until an admin provisions
`CROSS_REPO_ISSUE_TOKEN` the job cannot perform the close at all.

That second mode is deliberate, not a fallback. A workflow that quietly does
nothing because a secret was never provisioned is the shape this repo keeps
having to fix — #4449's `validateFormLayout` was written, tested, exported, and
called by nothing, running on zero stacks for as long as it existed. A missing
credential has to announce itself.

Matched references are restricted to the qualified `owner/repo#N` form; the
bare `#N` form already works natively and is left alone. Same-repo qualified
references are filtered out, already-closed targets are skipped, and one
unreachable target cannot swallow the rest or read as success.
