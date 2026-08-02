---
---

fix(ci): rename the cross-repo client — `github-script` already declares `octokit`

Release-nothing: touches `.github/workflows/cross-repo-issue-closer.yml` only.

`actions/github-script` injects an `octokit` binding into the script scope, so
the `const octokit = require('@actions/github').getOctokit(token)` added in
#4553 aborted the run before a single line of logic executed:

    SyntaxError: Identifier 'octokit' has already been declared

This surfaced on #4553's own merge — the first time the workflow ever ran, and
the first time any of its runtime behaviour was exercised. Until this lands,
every merged pull request in this repository carries one red check.

The pre-merge validation missed it for an instructive reason. The script was
syntax-checked against a hand-written wrapper declaring `{github, context,
core, require}` — and a wrapper that omits an injected identifier cannot
possibly see a collision with it. The check reported clean because it was
asking a narrower question than the runtime asks. The wrapper now carries the
full injected set, and the previous spelling fails it.
