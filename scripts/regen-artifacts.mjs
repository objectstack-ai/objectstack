// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one table of **generator-owned artifacts** — the files whose merge
 * semantics are "recompute from the merged sources", not "three-way text merge"
 * (#4675).
 *
 * Three consumers read this and nothing else: `.gitattributes` (which paths get
 * `merge=os-regen`), the merge driver (`git-merge-regen.mjs`), and the
 * `pre-commit` hook that makes the deferred regeneration mandatory. They must
 * agree exactly, so `git-merge-regen.mjs --self-test` reconciles `.gitattributes`
 * against this array in BOTH directions rather than trusting them to stay in
 * step — the same reason `check:generated` reconciles its own ledger against
 * `package.json` on every run.
 */

/**
 * Artifacts the driver takes over. `check` proves currency, `gen` restores it.
 * Both names are verified against `packages/spec/package.json` by `--self-test`,
 * so a renamed script fails loudly here instead of silently disarming a path.
 */
export const REGEN_ARTIFACTS = Object.freeze([
  { path: 'packages/spec/spec-changes.json', gen: 'gen:spec-changes', check: 'check:spec-changes' },
  { path: 'docs/protocol-upgrade-guide.md', gen: 'gen:upgrade-guide', check: 'check:upgrade-guide' },
  { path: 'packages/spec/authorable-surface.json', gen: 'gen:schema', check: 'check:authorable-surface' },
  { path: 'packages/spec/json-schema.manifest.json', gen: 'gen:schema', check: 'check:authorable-surface' },
  // `gen:api-surface` reads the BUILT `dist/*.d.ts`, never the source. On a
  // stale dist it does not fail — it emits a *plausible* surface missing every
  // export added since the last build, and `gen:docs` will ratchet a baseline
  // exemption in to cover the hole it leaves. That happened on #4687 and was
  // caught only by diffing the generated files against `main`. Hence
  // `readsDist`: every path that would regenerate these refuses unless the
  // build is newer than the sources it claims to describe.
  { path: 'packages/spec/api-surface.json', gen: 'gen:api-surface', check: 'check:api-surface', readsDist: true },
  {
    path: 'packages/spec/api-surface-signatures.json',
    gen: 'gen:api-surface',
    check: 'check:api-surface',
    readsDist: true,
  },
  { path: 'content/docs/references/**', gen: 'gen:docs', check: 'check:docs' },
  // #5107. Unlike its neighbours this one is derived from the AST *plus* a
  // hand-written column (the ledger's `Class` verdicts feed the per-class
  // subtotals), which is exactly why it belongs here rather than in the ledger:
  // the arithmetic composes on a merge, the judgement does not, so they had to
  // stop living in one file. The ledger itself stays hand-written and is NOT
  // driver-managed — regenerating prose would delete somebody's evidence.
  {
    path: 'docs/audits/2026-07-unknown-key-strictness-ledger.counts.md',
    gen: 'gen:strictness-ledger',
    check: 'check:strictness-ledger',
  },
]);

/**
 * Tracked files that LOOK generator-owned and deliberately are not. Recorded
 * rather than omitted: the dangerous mistake here is adding a path to
 * `.gitattributes` because a generator writes it, without asking whether
 * recomputing it can *lose* a decision a human made.
 */
export const NOT_DRIVER_MANAGED = Object.freeze([
  {
    path: 'packages/spec/docs-import-surface.baseline.json',
    why:
      'a SHRINK-ONLY ratchet. `gen:docs` writes it, but regenerating it can WIDEN it — '
      + 'a fresh gap gets a fresh exemption line, which is precisely how "a ratchet quietly stops '
      + 'ratcheting" (its own words). Recomputing that during a merge would launder a new '
      + 'exemption in as merge noise. A text conflict here deserves a human.',
  },
  {
    path: 'packages/spec/dual-source-exports.baseline.json',
    why:
      'hand-ratcheted under review by design — check:generated already records that a `gen:` '
      + 'which rewrites it would admit a new dual-source via "run the fix command" instead of via '
      + 'a maintainer decision (#4446).',
  },
  {
    path: 'packages/spec/variant-docs.json',
    why: 'hand-maintained map of the schema variants; `check:variant-docs` audits it against the code, no generator.',
  },
  {
    path: 'packages/spec/src/migrations/registry.ts',
    why:
      'hand-written source. Conflicts here are two retirements appended at the same spot — '
      + 'keeping both is usually right, but "usually" is a human judgement, not a merge rule.',
  },
  {
    path: 'packages/spec/src/conversions/registry.ts',
    why: 'hand-written source, same as the migrations registry.',
  },
  {
    path: 'docs/audits/**',
    why:
      'hand-written audit ledgers — Class verdicts, evidence, findings logs. The ONE exception is '
      + 'the strictness ledger\'s `.counts.md`, declared above: #5107 split the ledger\'s numbers out '
      + 'precisely so the prose could keep text-merging (it always merged cleanly) while the numbers '
      + 'stopped (they merged clean and WRONG). Regenerating a ledger would discard evidence, which is '
      + 'the opposite trade — so this exclusion covers the prose and must stay.',
  },
]);

/** Marker file (inside the git dir, never the worktree) listing paths the driver deferred. */
export const PENDING_MARKER = 'os-regen-pending';

/** The git config key pair that registers the driver in a clone. */
export const DRIVER_NAME = 'os-regen';

/**
 * The script git runs as the merge driver, as a shell word (#4868).
 *
 * Resolved at MERGE time against the worktree being merged, never at install time
 * against the worktree that happened to run `pnpm install`. Linked worktrees share
 * one `.git/config`, so an absolute path here is a container-wide setting written
 * by whoever installed last — and it dangles the moment that worktree is removed,
 * which AGENTS.md requires on task cleanup. See `setup-git-hooks.mjs` for the two
 * constraints this spelling satisfies and the two traps it avoids.
 */
export const DRIVER_SCRIPT_EXPR = '"$(git rev-parse --show-toplevel)/scripts/git-merge-regen.mjs"';

/**
 * Every git config setting that `pnpm install` registers, declared once.
 *
 * `setup-git-hooks.mjs` writes these; `git-merge-regen.mjs --self-test` asserts the
 * live config still matches them and that the driver script actually resolves. One
 * declaration, so the registrar and the gate cannot drift apart.
 */
export const GIT_SETTINGS = Object.freeze([
  { key: `merge.${DRIVER_NAME}.name`, value: 'regenerate generator-owned artifacts instead of text-merging' },
  // %O %A %B %P — ancestor, ours (the output file), theirs, pathname. Unquoted on
  // purpose: git generates %O %A %B as temp names and shell-quotes %P itself.
  { key: `merge.${DRIVER_NAME}.driver`, value: `node ${DRIVER_SCRIPT_EXPR} %O %A %B %P` },
  { key: 'core.hooksPath', value: '.githooks' },
]);

/** Resolve the entry that owns a path, or undefined. Handles the one `**` entry. */
export function entryForPath(p) {
  return REGEN_ARTIFACTS.find((e) =>
    e.path.endsWith('/**') ? p.startsWith(e.path.slice(0, -2)) : e.path === p,
  );
}
