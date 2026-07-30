---
---

Tooling only — no package changes, nothing to release.

The docs-drift mapper (`scripts/docs-audit/affected-docs.mjs`) no longer treats a
test-file change as a reason to flag docs. A test observes behaviour rather than
defining it, so it cannot make an implementation-accuracy doc stale — yet every
tests-only PR lit up its packages' whole doc set. Three in a row (#4064, #4078, and one
before) each flagged 6 `packages/services` docs for a diff containing no production
code.

That is the one place the mapper's deliberate over-inclusion actively hurt: a comment a
reader learns to skip stops doing its job on the PR where it is right.

- Test files are dropped before the changed-package roots are derived: `*.test.*` /
  `*.spec.*` at any depth, and anything under `__tests__` / `__mocks__` / `__fixtures__`.
- The narrowing is **not silent** — the excluded count appears in the summary line and
  as `testFilesSkipped` in `--json`.
- A `--self-test` flag pins the matcher, following the convention of
  `check-error-code-casing` / `check-route-envelope`, and the drift workflow now runs it
  before computing the mapping. Verified to catch the dangerous direction: replacing the
  anchored match with a naive substring check fails 7 cases, including
  `control-flow.zod.ts` and `latest.ts` being swallowed as "tests".

Verified against real history: the tests-only commit `46e86bad` (#4078) now maps to 0
docs where it previously reported 6, while the implementation commit `4965bfac` (#4059)
still maps to the same 11 docs it did before.
