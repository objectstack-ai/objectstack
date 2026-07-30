---
---

Docs only — no package changes, nothing to release.

Records why `packages/*/CHANGELOG.md` is **not** added to the docs-drift mapper's test-file
exclusion (#4091). It reads as the obvious next narrowing and is a provable no-op:

- `chore: version packages` is the only PR class that mass-touches those files, and it runs
  no GitHub Actions — `changesets/action` opens it with the repo `GITHUB_TOKEN`, which by
  design triggers no workflow runs. Measured on #3910: one check run, Vercel's own app.
  The version bump is still verified, just post-merge (`ci.yml` / `lint.yml` on `push: main`,
  and `release.yml` gates publish on a green build).
- `changeset version` writes `package.json` beside every `CHANGELOG.md` it appends to
  (45 vs 46 on page 1 of #3910's diff), so excluding the CHANGELOGs would leave the derived
  package-root set bit-identical anyway.

Written down so the next reader does not spend a PR rediscovering it as a gap.
