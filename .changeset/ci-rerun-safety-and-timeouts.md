---
---

chore(ci): a nightly rerun-safety gate, job timeouts, and a compiled-tests-in-dist guard

Three CI changes, all of them lessons #4065 taught the hard way. No package
changes — CI configuration only.

**1. Nightly rerun-safety gate (`rerun-safety-nightly.yml`).** Every job in this
repo runs on a fresh clone, which makes CI structurally incapable of seeing a
suite that pollutes its own working tree and therefore passes exactly once. CI
always runs pass #1, so it is always green. #4065 sat in the repo through every
CI run it ever had and surfaced only because somebody ran the full suite twice in
one checkout while doing unrelated work — where it looked like *their* change had
broken something. The new job runs the full suite twice in one tree with
`--force` (turbo would otherwise replay the cache and report green without
executing anything) and fails if the second pass disagrees with the first. It
also prints any `.objectstack/` directories left behind between passes, so a
failure names a file instead of reading as flakiness.

**2. `timeout-minutes` on all eight `ci.yml` jobs.** There were none, so every
job inherited GitHub's 6-hour default. On PR #4100 the Test Core job hung with no
output for 80 minutes and would have held a runner for six hours — and the whole
time the PR read as "still running" rather than broken, which is the worst
failure mode a gate can have. Ceilings are ~3-4× the healthy observed duration,
so a genuinely slow run still passes.

**3. A build-output guard against compiled test files.** A package built with
plain `tsc` that does not exclude tests emits `dist/**/*.test.js`. `files:
["dist"]` then publishes them to npm — and, worse, a package with no vitest
config *collects* those compiled copies alongside its sources, so every
`src/**/*.test.ts` also runs as a stale `dist/**/*.test.js` frozen at the last
build. `@objectstack/cli` shipped exactly that (81 test files / 849 tests where
its sources hold 58 / 581) until #4065 excluded them. That silently defeats
edits: a fix to a source test appears not to work because the run is still
executing the pre-fix duplicate. Everything else here builds with tsup, which
emits only declared entry points — so this gate exists to stop the *next*
tsc-built package repeating it, not to re-check the one already fixed.
