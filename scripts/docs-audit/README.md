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
```

Heuristic: a doc is *affected* by a changed package `P` if it mentions `P`'s npm
name (`@objectstack/<x>`) or repo path (`packages/<x>`). Over-inclusion is preferred
over misses; the periodic **full** audit (part 4) is the backstop for docs that
describe a package without naming it.

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
