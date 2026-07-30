# Docs accuracy verification

Keeps the **hand-written** docs (`content/docs/**` minus `content/docs/references/**`)
in sync with the actual implementation in `packages/**` as the platform evolves.
Generated references (`content/docs/references/`) are produced from `packages/spec`
and are out of scope here — regenerate those separately.

The system has four parts, layered cheapest-and-earliest first:

## 1. `affected-docs.mjs` — change → docs mapping (the linchpin)

Maps a set of `packages/**` changes to the hand-written docs that reference the
affected packages, so an audit can be scoped to what actually changed.

```bash
# docs affected by changes on this branch vs origin/main
node scripts/docs-audit/affected-docs.mjs origin/main

# JSON (with changed packages + per-doc "why")
node scripts/docs-audit/affected-docs.mjs --json origin/main

# every hand-written doc (full audit scope)
node scripts/docs-audit/affected-docs.mjs --all

# check the test-file matcher (needs no repo state; CI runs this before the mapping)
node scripts/docs-audit/affected-docs.mjs --self-test
```

Heuristic: a doc is *affected* by a changed package `P` if it mentions `P`'s npm
name (`@objectstack/<x>`) or repo path (`packages/<x>`). Over-inclusion is preferred
over misses; the periodic **full** audit (part 4) is the backstop for docs that
describe a package without naming it.

**One exclusion:** changes to **test files** are dropped before the changed-package
roots are derived. A test observes behaviour rather than defining it, so it cannot make
an implementation-accuracy doc stale — yet counting them made every tests-only PR light
up its packages' whole doc set, a class of finding that is always false. That is the one
place over-inclusion actively hurt: a comment a reader learns to skip stops working on
the PR where it is right. The count of excluded files is reported in the summary and as
`testFilesSkipped` in `--json`, so the narrowing is never silent, and `--self-test`
pins the matcher against paths that must and must not match (`commands/test.ts` is
implementation; `foo.conformance.test.ts` is not).

**And one deliberate non-exclusion:** `packages/*/CHANGELOG.md` stays counted, even though
release notes define behaviour no more than a test does. Extending the exclusion there
looks like the obvious next step and is a provable no-op, for two independent reasons:

1. The only PR class that mass-touches those files is `chore: version packages`, and it
   runs **no GitHub Actions at all** — `changesets/action` opens it with the repo's
   `GITHUB_TOKEN`, and GitHub does not trigger workflow runs from `GITHUB_TOKEN`-authored
   events. Measured on #3910: one check run, from Vercel's own app. So this gate never
   sees a release PR to be noisy on. (The bump is still verified — `ci.yml` and `lint.yml`
   both run on `push: main`, and `release.yml` gates publish on a green build.)
2. Even if it did run, `changeset version` writes `package.json` next to every
   `CHANGELOG.md` it appends to — 45 of the former against 46 of the latter on the first
   page of #3910's diff — so dropping the CHANGELOGs would leave the derived package-root
   set bit-identical.

A hand-edited CHANGELOG outside a release is also close to nonexistent in practice. Left
counted, and recorded here so the idea is not rediscovered as a gap.

## 2. CI gate — `.github/workflows/docs-drift-check.yml`

On any PR that touches `packages/**`, runs `affected-docs.mjs` against the base branch
and posts/updates a single advisory PR comment listing the docs that reference the
changed code. **Never fails the build** — it only flags drift at the source, before it
lands on `main`. Reviewers (or an on-demand audit run) decide whether to re-verify.

## 3. `docs-accuracy-audit` workflow — the LLM audit

A Claude Code multi-agent workflow (`.claude/workflows/docs-accuracy-audit.js`). For each
doc: an agent reads it, locates the real implementation, and applies evidence-backed
fixes in place; a second **adversarial verifier** re-checks every fix against the code and
repairs over-corrections. Scope it with `args.docs`; omit for a full audit.

```js
// scoped to the docs a code change touched:
Workflow({ name: 'docs-accuracy-audit', args: { docs: [/* output of affected-docs.mjs */] } })
// full audit of all hand-written docs:
Workflow({ name: 'docs-accuracy-audit' })
```

It edits files in place (frontmatter preserved, no moves) and returns a per-doc log of
fixes, verifier repairs, and residual items that couldn't be confirmed against code.
Always follow a run with the docs build gate:

```bash
pnpm --filter @objectstack/docs build   # must compile all pages clean
```

## 4. Scheduled routine — periodic backstop

A cron routine (created via the `schedule` skill) runs on a cadence (default monthly /
per-release) to catch drift the CI gate missed. It computes the change-scoped doc list
since the last audit, runs the `docs-accuracy-audit` workflow on it, runs the build, and
opens a PR when there are fixes. See the routine prompt for the exact steps.

---

**Cost note:** a full audit of all 128 hand-written docs is ~2.8M output tokens / ~160
agents. Always prefer the change-scoped list (`affected-docs.mjs`) over `--all` except for
the periodic full backstop.
