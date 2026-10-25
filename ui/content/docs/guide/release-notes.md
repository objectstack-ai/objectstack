---
title: "Release Notes"
description: "Where to find what shipped in each ObjectUI release — the per-package changelogs and GitHub Releases."
---

# Release Notes

ObjectUI does not keep a hand-written release history on this page. Two sources carry
it, both written as part of the release itself:

- **Each package's own `CHANGELOG.md`** — the source of truth for granular history.
  Changesets writes an entry into every affected `@object-ui/*` package on each release
  commit, so the changelog beside the package you depend on states exactly what changed
  in it, including breaking changes and migration notes. Read it in the installed
  package (`node_modules/@object-ui/<name>/CHANGELOG.md`), on that package's npm page,
  or in this repository under
  [`packages/<name>/CHANGELOG.md`](https://github.com/objectstack-ai/objectui/tree/main/packages).
- **[GitHub Releases](https://github.com/objectstack-ai/objectui/releases)** — every
  published version, newest first, with its tag and publication date. Start here to see
  which version is current.

The monorepo
[CHANGELOG.md](https://github.com/objectstack-ai/objectui/blob/main/CHANGELOG.md)
is a periodically hand-curated summary, not an auto-maintained record, and can lag the
latest releases. Treat each package's own `CHANGELOG.md` as authoritative where the two
disagree.
