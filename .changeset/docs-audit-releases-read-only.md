---
---

tooling: audit release-owned docs read-only instead of editing them (#4920)

`content/docs/releases/**` stays in the `docs-accuracy-audit` scope but is now reviewed
**read-only**: those 9 pages get a review prompt that forbids edits and a finding schema
with no `fixesApplied`, and their deliverable is a list of evidence-backed findings to
file as issues. AGENTS.md marks the directory RELEASE-OWNED — release notes are compiled
centrally at release time — while the audit's deliverable is an in-place mdx rewrite, so
a full audit used to open exactly the PR that guardrail exists to stop.

Excluding them was rejected: it would leave the most-read pages permanently unaudited
and add a second definition of the audit's scope next to the generated one (#4851).
Silence was rejected too — a release page that produces no result, or whose agent admits
it edited the file, fails the run by name, and the summary always carries
`releases (read-only): N finding(s) — file issues, do not edit`, zero findings included.

`pnpm check:docs-audit-scope` now also anchors the prefix to AGENTS.md's guardrail row,
requires release pages to still be in scope, and verifies the read-only fork by running
the workflow against stub agents; the self-test mutates the fork away and requires that
check to go red.
