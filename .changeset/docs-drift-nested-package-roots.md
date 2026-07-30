---
---

Tooling only — no package changes, nothing to release.

The docs-drift mapper (`scripts/docs-audit/affected-docs.mjs`) derives a changed
file's package root from the filesystem — the deepest ancestor directory with a
`package.json` — instead of a regex that special-cased only `packages/plugins/*`.
Under the old derivation the 30 packages nested under the other six container
directories (`services/`, `connectors/`, `apps/`, `qa/`, `triggers/`, `adapters/`)
collapsed into their container, whose missing `package.json` left the npm name
unresolved and the npm-name matching arm dead: any doc that names
`@objectstack/service-automation` but never the repo path was a guaranteed miss
(#4162), the one direction this tool promises to avoid. No hardcoded container
list replaces the special case — that would fail the same way again on container
number eight (#3786's pattern).

- Verified against real history: on #4161's commit the drift comment attribution
  changes from the directory name `packages/services` to
  `@objectstack/service-automation`. A synthetic service-automation-only change
  goes from 6 docs — all belonging to *other* services, matched via the coarse
  `packages/services` path token, with `automation/flows.mdx` absent — to the 4
  right ones, `flows.mdx` first among them.
- Second arm (from #4162's comment thread): `<packageRoot>/scripts/**` is
  build/verification tooling and no longer counts as an implementation change
  (#4183 flagged 106 docs for a diff whose only code change was a new check
  script). Kept narrow: `package.json` and `src/scripts/**` stay counted.
  Publication check done — no package ships runtime code from `scripts/`; three
  plugins publish a lone `i18n-extract.config.ts` only for lack of a `files`
  field. A scripts-only change now maps to 0 docs (was 106); the exclusion is
  reported in the summary and as `scriptFilesSkipped` in `--json`, never silent.
- `--self-test` now pins the package-root derivation and the tooling-script
  classifier too (32 cases, hermetic via an injected fake tree), closing the
  guard-of-the-guard hole: the original self-test pinned only the test-file
  matcher, so this bug was invisible to it. Includes the two invariants from the
  issue: a container directory must never come out as a package root, and
  `packages/x/package.json` is implementation while `packages/x/scripts/y.ts`
  is not.
