---
---

ci(release): build GitHub Releases ourselves, with bodies that fit the 125k limit (#4900)

**Deliberately empty frontmatter — this PR releases nothing.** It changes only
`.github/workflows/release.yml`, `.github/workflows/lint.yml`, root `scripts/`
and one `check:` script entry in the root `package.json`. Not a byte of it
reaches any published package: the root manifest is private, and `scripts/` at
the repo root is release tooling, never packaged (`check:published-files` is the
gate that keeps `<pkg>/scripts/**` out of the npm artifacts, and this is one
level above even that). A non-empty changeset here would bump all 69 packages of
the Changesets `fixed` group in lockstep and burn an extra `rc` on a change that
ships no product code.

The empty-frontmatter form is the repo's sanctioned "this PR releases nothing"
declaration, on par with the `skip-changeset` label, per `Check Changeset` in
`.github/workflows/pr-automation.yml`. This PR carries the label as well; the
file exists so the declaration is a durable record in the repo rather than a
label anyone can remove later.

One caveat worth stating where the next reader will find it, because this PR is
about the release machinery: an empty changeset is the exact input #4898 showed
can jam a release — `changesets/action` enters its publish branch only with ZERO
pending changesets, and an empty one still counts as pending. That is now
bounded rather than silent. The recovery step #4899 added, made reachable and
given the right invariant by #4901, catches precisely that case (repo version
absent from npm → publish; image absent → request the Docker job), and this PR
extends the GitHub Releases and the ADR-0087 D4 `spec-changes.json` attachment to
that same recovery path — which they never covered before. So if this changeset
is ever the only pending one when a version bump lands, the release is repaired
and reported, not lost.

What the change itself does: `changesets/action`'s `createGithubReleases` posted
each package's raw CHANGELOG section as the Release body, and
`@objectstack/spec`'s section for one v17 RC is 342,893 characters against the
API's 125,000 limit. The 422 fired inside `runPublish` — after `changeset
publish` had fully succeeded but before the action set its `published` output —
so the step went red, `published` stayed false, and the `docker` job gated on it
was skipped: a published npm version with no runtime image. The action now has
`createGithubReleases: false` and `scripts/release-github-releases.mjs` creates
the Releases instead, truncating an over-limit body to fit and linking the
complete entry in `CHANGELOG.md`, idempotently (PATCH when the release exists),
and per package rather than under one `Promise.all`.
