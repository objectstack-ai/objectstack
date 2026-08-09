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

# pin the change classifiers + package-root derivation (needs no repo state; CI runs this before the mapping)
node scripts/docs-audit/affected-docs.mjs --self-test
```

Heuristic: a doc is *affected* by a changed package `P` if it mentions `P`'s npm
name (`@objectstack/<x>`) or repo path (`P`'s directory, e.g.
`packages/services/service-automation`). Over-inclusion is preferred over misses; the
periodic **full** audit (part 4) is the backstop for docs that describe a package
without naming it.

**How a changed file maps to its package:** the package root is the **deepest ancestor
directory with a `package.json`**, resolved from the filesystem — never a hand-kept
list of container directories. (The mapper once special-cased only
`packages/plugins/*`; the 30 packages nested under the other six containers collapsed
into `packages/services` et al., whose missing `package.json` disabled the npm-name
matching arm entirely, so a doc naming `@objectstack/service-automation` but not the
repo path was a guaranteed miss — #4162.) A deleted package falls back to the coarse
`packages/<x>` token, which still substring-matches any doc naming the deleted path.

**Three exclusions:** change classes that cannot make an implementation-accuracy doc
stale are dropped before the changed-package roots are derived:

1. **Test files** (`*.test.*` / `*.spec.*` at any depth, plus `__tests__` /
   `__mocks__` / `__fixtures__`): a test observes behaviour rather than defining it —
   yet counting them made every tests-only PR light up its packages' whole doc set, a
   class of finding that is always false. That is the one place over-inclusion actively
   hurt: a comment a reader learns to skip stops working on the PR where it is right.
2. **Package tooling scripts** (`<packageRoot>/scripts/**`): build/verification
   tooling, not the runtime behaviour docs describe (#4183 flagged 106 docs for a diff
   whose only code change was a new check script). Narrow on purpose: `src/scripts/**`
   is runtime code and stays counted. No package publishes runtime code from `scripts/`
   (checked against every `files` allowlist; three plugins ship a lone
   `i18n-extract.config.ts` only for lack of a `files` field).
3. **Dev-only manifest edits** (#6893): a `<packageRoot>/package.json` whose changed
   **top-level keys** are all in `{scripts, devDependencies}`. This is the only
   **field-level** exclusion — `package.json` as a file stays counted, because
   `exports` / `main` / `dependencies` / `files` / `version` changes ARE implementation.

   It is the residue of exclusion 2: #4183 dropped the check *script* but kept the
   `package.json` line registering it, so the same PR still lit up the same doc set
   through the manifest. Measured over 400 merged commits, five had a `package.json` as
   their only `packages/**` implementation change, and **all five** touched nothing but
   those two keys — 152 doc-rows in total, none of which could be stale:

   | commit | keys changed | docs flagged |
   |:--|:--|--:|
   | `df0605ba5` | `scripts` | 12 |
   | `2672f855f` | `scripts` | **113** — #6893's headline number |
   | `a64315556` | `devDependencies` | 10 |
   | `77d9001c7` | `devDependencies` | 13 |
   | `466bd9285` | `devDependencies` | 4 |

   The last three are `test(...)` commits: exactly the class exclusion 1 exists to kill,
   leaking through the manifest instead. The allowlist is an allowlist on purpose — an
   unknown or newly-invented key falls on the **counted** side — and unparseable, added
   or deleted manifests are counted too.

   **Why it cannot narrow the net:** the classifier is per *file*. A PR that also touches
   that package's `src/**` derives the package root from those files anyway, so this arm
   only ever decides the case where the manifest is the package's sole change. Verified
   both directions on the real diffs (#6893): adding an `exports` entry to
   `packages/spec/package.json` still flags 113 docs, and a `scripts` entry *alongside* a
   `src/` edit also still flags 113 — with the manifest itself reported as skipped.

The excluded counts are reported in the summary line and as `testFilesSkipped` /
`scriptFilesSkipped` / `devOnlyManifestsSkipped` in `--json`, so the narrowing is never
silent. `--self-test` pins the classifiers *and* the package-root derivation against
paths that must and must not match (`commands/test.ts` is implementation;
`foo.conformance.test.ts` is not; a container directory must never come out as a package
root; `dependencies` is never dev-only).

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
   set bit-identical. Exclusion 3 does **not** undercut this: what `changeset version`
   rewrites is `version` (and workspace `dependencies` ranges), neither of which is in
   the dev-only allowlist, so those manifests stay counted.

A hand-edited CHANGELOG outside a release is also close to nonexistent in practice. Left
counted, and recorded here so the idea is not rediscovered as a gap.

## 1b. `check-audit-scope.mjs` — the audit workflow's scope, derived not hand-kept

```bash
node scripts/docs-audit/check-audit-scope.mjs           # verify (also: pnpm check:docs-audit-scope)
node scripts/docs-audit/check-audit-scope.mjs --write   # regenerate the list from the filesystem
node scripts/docs-audit/check-audit-scope.mjs --self-test
```

The `docs-accuracy-audit` workflow (part 3) carries its default scope **inline**, as
`ALL_HANDWRITTEN`. It has to: a workflow script runs inside a `node:vm` context whose
only globals are `log`/`phase`/`console`/`budget`/timers plus
`agent`/`parallel`/`pipeline`/`workflow`/`args`, with code generation disabled — no
`require`, no `import`, no filesystem. It can neither walk `content/docs/` nor read a
JSON artifact, so the list cannot be derived *at run time*.

It is therefore derived at *generation* time instead: `--write` rewrites the block from
`affected-docs.mjs --all` (one definition of "hand-written doc", not two), and the plain
run is a CI gate in `lint.yml` that fails when the block and `content/docs/` disagree
**in either direction**.

Both directions matter, and only one had ever been noticed (#4851):

- **listed but missing** — the 10 `content/docs/protocol/objectos/**` paths left behind
  by the rename to `protocol/kernel/`, plus 6 others. An audit agent pointed at a
  non-existent file reads nothing and reports `fixCount: 0`, which in the run summary is
  indistinguishable from a doc that was checked and found accurate. That is how the
  accuracy defects in #4781 and #4817 sat in `protocol/kernel/` for ~2 months while full
  audits reported green.
- **exists but unlisted** — 48 docs, including all of `protocol/kernel/**` and the whole
  `capabilities/` directory. A run logging `FULL audit (no args.docs given)` was
  auditing 130 of 178 docs.

The workflow additionally preflights its resolved scope — including a caller-supplied
`args.docs`, which no CI gate can see — and aborts naming any path that does not exist;
and each audit agent reports `docExists` from the read path itself, so a preflight that
was wrong cannot be laundered into a green summary. The gate covers the default list,
the preflight covers the caller's list, and the read path checks both.

### Release-owned pages are in scope, and read-only (#4920)

The derived scope contains `content/docs/releases/**` (9 pages), and AGENTS.md's
Documentation Guardrails forbid a code PR from editing those pages at all. Since the
audit's deliverable is an in-place mdx rewrite, a full audit used to walk straight into
that prohibition — and open exactly the PR the guardrail exists to stop.

They are **not** excluded. Excluding them would leave some of the most-read pages in the
docs permanently unaudited, and would put a second definition of "docs this workflow
covers" next to the generated block — #4851 is the bill for one subject with two
hand-kept lists. Instead the **deliverable** forks, on a path prefix (`content/docs/
releases/`, which is the guardrail's own path column, decidable inside the workflow VM):

| | editable docs | release-owned pages |
|:--|:--|:--|
| prompt | audit + **fix in place** | review, **never edit** |
| output schema | `fixesApplied` / `fixCount` | `findings[]` + `filesEdited` |
| adversarial verifier | yes — re-checks applied edits | n/a, nothing was applied |
| deliverable | the diff | findings → **file as issues** |

Each finding carries `kind` (`never-true` / `no-longer-true` / `ambiguous` — a release
page is a historical record, so "the current API differs" is not automatically an
error), where on the page it is, what it should say instead, and `file:line` evidence.
The run summary reports them under `releaseOwnedReadOnly` and logs
`releases (read-only): N finding(s) — file issues, do not edit`.

Three failure modes are made loud rather than silent, because "audited nothing" and
"audited, found nothing" must never look alike:

- a release page whose review returns **no result** fails the run by name — that is the
  exclusion option arrived at by accident;
- a review agent reporting `filesEdited: true` fails the run naming the file to revert;
- the read-only headline is logged whenever release pages are in scope, **including at
  zero findings** (reviewed-and-clean is a result, absence is not).

`pnpm check:docs-audit-scope` enforces the whole contract: AGENTS.md must still mark
that exact path RELEASE-OWNED, the workflow's `RELEASE_OWNED_PREFIX` must still match
that row, the scope must still contain release pages, and the fork must still work —
checked by **running** the workflow against stub agents and inspecting which prompt and
schema each doc gets, not by grepping for a keyword. `--self-test` then mutates the fork
out of an in-memory copy and requires that check to go red.

## 2. CI gate — `.github/workflows/docs-drift-check.yml`

On any PR that touches `packages/**`, runs `affected-docs.mjs` against the base branch
and posts/updates a single advisory PR comment listing the docs that reference the
changed code. **Never fails the build** — it only flags drift at the source, before it
lands on `main`. Reviewers (or an on-demand audit run) decide whether to re-verify.

### The comment forks release-owned pages into a read-only section (#6893)

Same ruling as [1b](#release-owned-pages-are-in-scope-and-read-only-4920), one level
down. The comment used to list `content/docs/releases/v17.mdx` in the same bulleted list
as editable pages — so a reader treating the advisory as a worklist was being pointed at
the one edit AGENTS.md forbids outright. The specimen that made it concrete: PR #6921
changed two diagnostic strings in `packages/lint` and got back three rows, one of them
that release page.

They are **not filtered out**. `docs` in `--json` stays the full set (it is what scopes
the audit, and #4920 rejected excluding these pages for good reasons); `releaseOwnedDocs`
is a **partition** of it — `releaseOwnedDocs ⊆ docs`, always — and the comment renders it
under its own ⛔ heading telling the reader to file an issue instead of editing.

`affected-docs.mjs` therefore holds a third literal copy of `RELEASE_OWNED_PREFIX`,
alongside AGENTS.md's guardrail row and the audit workflow's own const. Copies, because
the workflow is evaluated in a sandbox VM that cannot import and a shared module would
leave *it* the only unanchored one. `check-audit-scope.mjs` iterates
`RELEASE_OWNED_CONSUMERS` and fails if any copy stops matching the guardrail row — **add
a consumer, add it to that list.**

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
fixes, verifier repairs, and residual items that couldn't be confirmed against code —
**except** for `content/docs/releases/**`, which is reviewed read-only and returns
findings to file as issues (see [1b](#release-owned-pages-are-in-scope-and-read-only-4920)).
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

**Cost note:** a full audit is ~2 agents per doc — measured at ~2.8M output tokens /
~160 agents when the scope was 128 docs, and the hand-written set is 178 today (run
`check-audit-scope.mjs` for the current number; don't trust a count written down here).
Always prefer the change-scoped list (`affected-docs.mjs`) over `--all` except for the
periodic full backstop.
