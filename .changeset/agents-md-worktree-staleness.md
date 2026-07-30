---
---

Two additions to AGENTS.md's multi-agent discipline. Deliberately empty
frontmatter: documentation, this releases nothing.

**#9 — refresh a long-lived worktree's build state after merging `main`.** Four
distinct stale artefacts each fail *as if your change broke something*, naming
other people's exports, other packages' files, or config you never touched:
`packages/spec/dist` (makes `check:api-surface` report someone else's exports as
breaking, and `check:i18n-coverage` reject a valid example config), `node_modules`
(a package cannot resolve a dependency it plainly declares), `packages/runtime/
.objectstack/` (fixture rows accumulating across runs), and `.cache/objectui-*`
(dozens of lint errors in files you have never opened). None is CI-visible — CI
checks out fresh — so the cost lands entirely on whoever is debugging. Also notes
that `OS_SKIP_DTS=1` leaves no `.d.ts`, which makes `gen:api-surface` impossible
rather than merely slow.

**#10 — a clean merge is not a working merge.** Git conflicts on overlapping
lines; nothing warns when two changes are individually fine and jointly wrong.
Both examples are real and recent: a test pinning a response body's exact shape
landed while that shape was being changed elsewhere, and a domain file was deleted
while another agent's guard still declared it. The first merged clean and failed
CI; the second was caught only because the guard existed. Hence: pull `main` and
re-run before opening a PR, and again before merging.

Written from one branch's lifetime — every row is a failure that cost a debugging
round, so the list is what was actually hit rather than what might happen.
