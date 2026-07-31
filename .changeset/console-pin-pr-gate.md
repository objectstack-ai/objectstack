---
---

ci: build the pinned objectui SHA on the PR that moves it (#4290)

`.objectui-sha` is the single source of truth for the vendored Console SPA —
release.yml reads it, clones objectui at that commit, builds
`@object-ui/console` and copies the dist into `packages/console/`. Editing that
one line replaces the entire frontend the platform ships, and nothing on the PR
side ever built it.

The pin appeared in exactly two workflows, neither a gate: release.yml
(post-merge, on the main push) and showcase-smoke.yml (manual + nightly, whose
own header says "it never gates PRs"). It is also a root dotfile, so it matched
neither of ci.yml's `core` and `docs` filters — #4288 moved the pin 76 commits
with six of fourteen checks skipped, including Build Core, Test Core, Build Docs
and the Dogfood gate. A SHA that cannot build — a typo, a commit that was
force-pushed away, a broken objectui, a dead bundle canary — reached `main`
green and would have surfaced at publish time. The only thing between the two
was the author remembering to run `scripts/build-console.sh` locally.

Adds ci.yml's `Console Pin Gate`: a `console` paths filter over `.objectui-sha`,
`scripts/build-console.sh` and the two files that gate them, and a job that
builds `@object-ui/console` at the pin against this tree's `@objectstack/client`
and then runs `pnpm check:console-sha`.

Two details that keep it honest rather than merely green:

- It restores `packages/console/dist` under **release.yml's existing cache key**
  (`hashFiles('.objectui-sha', 'scripts/build-console.sh')`), so only a pin the
  repo has never built misses — and a miss is exactly when the gate has work to
  do. Watching the workflow and the drift guard therefore costs about a minute,
  not a full vite build.
- The restore/save pair is **split**, where release.yml uses the combined
  action, because the combined post-step saves even when the job failed.
  `build-console.sh` writes the SHA stamp before it asserts the bundle canary,
  so a canary failure leaves a stamped-but-broken dist that would be cached,
  restored, and then waved through the stamp check. Saving only once every
  assertion is green is what lets a restored dist carry the same guarantees as a
  freshly built one. A separate step asserts a real dist is on disk first, since
  `check:console-sha` deliberately exits 0 when there is no dist at all.

Scope, stated plainly: this proves the pinned SHA builds. It does not cover a
`packages/client` change breaking the injected-client bundle — that input lives
under `packages/**`, and watching it here would rebuild the console on a large
fraction of every PR. release.yml remains the only check for that direction.

CI and docs only; this releases nothing.
