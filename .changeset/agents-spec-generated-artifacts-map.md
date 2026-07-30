---
---

Docs only — no package changes, nothing to release.

AGENTS.md now maps each `packages/spec` change to the generated artifact it
invalidates and the CI gate that catches it. The eight gates live in two jobs that
run them sequentially, so the first stale artifact masks the rest — #4040 got one
red build per artifact (a `.describe()` string via `check:docs`, then five new
exports via `check:api-surface`) with no logic error involved either time.

Also records the `check:api-surface` trap: it reads the built `dist/*.d.ts`, so a
stale `dist` reports exports as REMOVED when nothing was removed.
