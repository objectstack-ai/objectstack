---
---

fix(ci): hand the cross-repo token to github-script instead of requiring @actions/github

Release-nothing: touches `.github/workflows/cross-repo-issue-closer.yml` only.

`require('@actions/github')` is not resolvable from a github-script `script:`
block — the action bundles its dependencies, so the call fails at runtime with
`MODULE_NOT_FOUND`. The token is now handed to the action itself
(`github-token:`), which makes the injected `github` client the cross-repo one,
with `secrets.GITHUB_TOKEN` as the fallback so the report path can still
comment on the pull request when no cross-repo credential is configured.

Observed in objectui, whose copy of this workflow reached that line first. Its
run also confirmed the credential logging added alongside works, printing
`CROSS_REPO_ISSUE_TOKEN: configured` before failing at the require.

This supersedes #4573, which renamed the second client without removing it —
the rename fixed the identifier collision that aborted parsing, and only then
did the run get far enough to hit the unresolvable module. Three failures in
three consecutive runs, each one further down the same script: parse, resolve,
then (expected next) the API calls themselves.
