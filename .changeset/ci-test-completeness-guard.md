---
---

ci: assert every test vitest counted actually ran (#3825)

A vitest worker can die at the process level — a native module segfault, OOM, an
abort inside a binding. There is no JS error to catch, so the cases that worker
owned never run and the summary reports only what survived:

```
Test Files  1 passed (40)
      Tests  21 passed (401)
```

That leads with "passed". It is **380 tests short**. #3812 hit exactly this shape
(17 cases silently skipped, reported as `22 passed (23)`) and it was found by a
human reading the log closely — which is not a control.

**To be precise about the risk:** the run does exit non-zero, so the gate goes
red. The failure mode is not a false green, it is **a red that reads like a
pass** — someone triaging sees "passed" and a plausible file count and concludes
one file flaked, rather than that a fifth of the suite never executed. This turns
that into a specific, quantified error naming the package and the shortfall. It
also covers the genuinely dangerous variant, where a crash lands somewhere that
does not propagate a non-zero exit at all.

`scripts/check-test-completeness.mjs` reads a saved `turbo run test` log and
asserts, per package, that the tallies (`passed | skipped | failed`) sum to the
declared total. Reading the log rather than wrapping vitest means no change to
the 60+ per-package vitest configs.

Wired into `ci.yml`'s Test Core (both the PR and push steps) and both Dogfood
shards, each as a separate `if: always()` step so it runs **when the suite
failed** — that is when it earns its keep. A red suite plus a green completeness
check means real test failures; a red suite plus a red completeness check means a
worker died.

Two details that are load-bearing rather than incidental:

- The test steps now `tee` their output, and `set -o pipefail` goes with it.
  GitHub runs these with `bash -e`, which does **not** set pipefail, so
  `turbo … | tee` would report *tee's* exit status and a failing suite would go
  green. Verified both ways: with pipefail the step exits 7, without it exits 0.
- Zero summaries in the log is a **pass with an explicit note**, not a silent
  one — `turbo run test --affected` legitimately runs nothing when a PR touches
  no package.

Validated against the real logs from the #3830 Node 20/22 comparison rather than
synthetic fixtures: the Node 22 log passes (`68 packages, 16678 declared and all
16678 accounted for`), and the Node 20 log fails, naming `@objectstack/driver-sql`
and its 380 missing tests.
