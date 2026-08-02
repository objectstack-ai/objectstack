---
---

ci: fail a PR at open time when an earlier open PR already declares a fix for
the same issue (#4588)

Release-nothing: adds `.github/workflows/duplicate-fix-guard.yml` and updates
agent process docs (AGENTS.md, CLAUDE.md, pm-dispatch claim template) — no
package code.

GitHub lets any number of open PRs declare `Fixes #N` for the same issue.
On 2026-08-02, #4555 and #4559 both declared `Fixes #4551` and both were
implemented in full — 834 duplicate lines through the whole gate suite — with
the duplication machine-detectable from the second PR's open (03:08) yet
unnoticed by any human until 08:52. The shared GitHub identity made the
issue's assignee useless as a warning: "assigned to os-zhuang" reads the same
whether the claimant is you or another session.

Three changes, one per hole:

- **Duplicate Fix Guard workflow**: on PR opened/edited/reopened/synchronize,
  parse same-repo closing keywords and fail the PR if an EARLIER open PR
  (lower number) declares the same issue, naming it. First come, first
  served — matching the pm-dispatch "first claim comment wins" convention.
  The check is body-driven and re-runs on `edited`, so a red PR goes green
  the moment the conflict is resolved either way.
- **Claim comments must carry a session ID** (pm-dispatch template, AGENTS.md,
  CLAUDE.md): under a shared identity, the comment's session line is the only
  thing that makes "is this claim mine?" answerable.
- **Branch naming `claude/issue-<n>-<slug>`** (AGENTS.md): puts the issue
  number where `git ls-remote | grep issue-<n>` can find it; the workflow
  warns (never fails) when a fix PR's branch names no declared issue.
