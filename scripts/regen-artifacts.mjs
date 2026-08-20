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
  // Deliberately NOT sharded (#5837): keyed by version, so two PRs append under
  // different majors — a low-conflict shape the split would not improve.
  { path: 'packages/spec/spec-changes.json', gen: 'gen:spec-changes', check: 'check:spec-changes' },
  { path: 'docs/protocol-upgrade-guide.md', gen: 'gen:upgrade-guide', check: 'check:upgrade-guide' },
  // Sharded by category (#5837): one file per namespace, so two PRs touching
  // different categories never share a file. The reason it had to be sharded and
  // not merely driver-managed is that the driver is LOCAL — the GitHub merge
  // queue rebuilds server-side and runs no custom merge driver, so a textual
  // conflict there evicted the second PR and the spec lane could land one at a
  // time. The driver still owns the residue: two PRs in the SAME category.
  { path: 'packages/spec/authorable-surface/**', gen: 'gen:schema', check: 'check:authorable-surface' },
  // The deletion gate's in-tree anchor (#5235). Same sorted-array shape, same
  // conflict — two branches that each re-anchored it differ on the `baseRev`
  // header and on whatever main added in between, and a text merge of that is
  // never right, so it stays driver-managed.
  //
  // But it is the one path here with NOTHING TO REGENERATE after a merge. A stale
  // copy is not an error (on `main` the merge base is HEAD, so the file
  // necessarily trails its own surface by one PR): `check:authorable-surface`
  // proves it AUTHENTIC — `baseRev` on origin/main, keys matching that commit —
  // never current. Either side of the conflict is an authentic upstream snapshot,
  // so the driver keeping OURS is already the resolution, and the pre-commit gate
  // passes on it as-is.
  //
  // `gen` therefore still names `gen:schema` — correct for this file's two
  // neighbours, which a merge defers alongside it, and a harmless no-op for this
  // one since #5358 took the anchor out of every build. It deliberately does NOT
  // name the re-anchoring command (`gen:authorable-surface-base`): that mid-merge
  // is exactly #5370, where `merge-base(HEAD, origin/main)` still resolves to the
  // branch's OLD fork point and the anchor moves BACKWARDS — authentically, so no
  // gate objects. Re-anchor after the merge is committed, or not at all.
  // Stays a SINGLE file while its subject is sharded (#5837): nothing but an
  // explicit `--update-base` writes it, so it was never on the churn path that
  // made the other three the queue's serialization point — and its `baseRev` is
  // one commit for the whole surface, which a per-shard copy would let drift.
  { path: 'packages/spec/authorable-surface.base.json', gen: 'gen:schema', check: 'check:authorable-surface' },
  { path: 'packages/spec/json-schema.manifest/**', gen: 'gen:schema', check: 'check:authorable-surface' },
  // The #4666 default-value ratchet — what an author gets when they OMIT a key.
  // Same producer, same gate and the same sorted-array-per-category shape as its
  // authorable-surface sibling, so it merges the same way. A CHANGED default is
  // never resolved by regenerating: `check:authorable-surface` adjudicates it
  // against the merge base before this file is written at all, so the regen here
  // can only ever pick up a NEW key's default.
  { path: 'packages/spec/authorable-defaults/**', gen: 'gen:schema', check: 'check:authorable-surface' },
  // `gen:api-surface` reads the BUILT `dist/*.d.ts`, never the source. On a
  // stale dist it does not fail — it emits a *plausible* surface missing every
  // export added since the last build, and `gen:docs` will ratchet a baseline
  // exemption in to cover the hole it leaves. That happened on #4687 and was
  // caught only by diffing the generated files against `main`. Hence
  // `readsDist`: every path that would regenerate these refuses unless the
  // build is newer than the sources it claims to describe.
  { path: 'packages/spec/api-surface/**', gen: 'gen:api-surface', check: 'check:api-surface', readsDist: true },
  // Deliberately NOT sharded (#5837): 1.3KB, one line per `defineX` factory —
  // never the conflict surface its neighbour was.
  {
    path: 'packages/spec/api-surface-signatures.json',
    gen: 'gen:api-surface',
    check: 'check:api-surface',
    readsDist: true,
  },
  // The #4796 declaration-origin baseline: which source declaration each entry
  // point's exports resolve to. Sharded per entry point for the same
  // merge-queue reason `api-surface/` is, and rewritten by every retirement PR
  // — the exact churn profile the driver exists for. NO `readsDist`: it reads
  // `src/`, so a merge that moved sources is all it needs to be re-run against.
  { path: 'packages/spec/export-origins/**', gen: 'gen:export-origins', check: 'check:export-origins' },
  // `readsSchemaTree` is the `readsDist` above, one artifact over (#4723). Both
  // `gen:docs` and `check:docs` render from `packages/spec/json-schema/`, which is
  // GITIGNORED — a merge therefore never delivers it, and a leftover tree from
  // before the merge describes the sources as they were on one side of it. Until
  // #4723 `check:docs` began with `gen:schema`, so the tree was always rebuilt (at
  // the cost of a "check" that wrote two tracked files whenever they were behind).
  // With that step gone, the freshness is asserted instead: every path that would
  // run either script refuses unless the tree is newer than the sources.
  { path: 'content/docs/references/**', gen: 'gen:docs', check: 'check:docs', readsSchemaTree: true },
  // [#10096] The schema-free `/meta` URL-spelling data module — the checked-in
  // materialization of PLURAL_TO_SINGULAR ∪ registry-derived REST plurals. A
  // pure projection of its two sources (no hand-written half), so a conflict is
  // always resolved by regenerating; low-churn (moves only when a metadata type
  // is declared or the manifest map changes). No `readsDist`: the generator
  // tsx-loads `src/`, so a merge that moved sources is all it needs.
  {
    path: 'packages/spec/src/meta-spelling/meta-url-data.generated.ts',
    gen: 'gen:meta-url-spelling',
    check: 'check:meta-url-spelling',
  },
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
  // #7377. The liveness ledger's "Current state" table, split the way its
  // strictness neighbour above was: the NUMBERS here, the Notes prose left in
  // `packages/spec/liveness/README.md`, which is emphatically NOT driver-managed —
  // a Note is hand-written measurement, and regenerating one would manufacture a
  // verdict. The drift that forced the split was 9 of 30 rows disagreeing with the
  // gate, several beside Notes cells that enumerate their dead sets by hand.
  //
  // Two things distinguish it from the entry above. Its input is not the AST but
  // the LIVENESS GATE's own report (`check-liveness.mts --json`, the counting
  // method fixed in #4488), spawned by the generator rather than re-implemented —
  // a second walker would be a second definition of "classified", and the one that
  // wins would be whichever the artifact happened to be rendered from. And its
  // `check` is that same gate, so freshness is proven by the instrument that
  // produces the numbers rather than by a parser reading them back. No
  // `readsDist`: the gate walks `src/` Zod schemas through tsx, so a merge that
  // moved sources is all it needs to be re-run against.
  {
    path: 'packages/spec/liveness/state-counts.md',
    gen: 'gen:liveness-counts',
    check: 'check:liveness',
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
    path: 'packages/spec/test-typecheck-debt.json',
    why:
      'a SHRINK-ONLY ratchet, same trade as docs-import-surface.baseline.json above (#5286). '
      + '`gen:test-typecheck-debt` writes it, and on a merge it is exactly the file two branches '
      + 'both re-record — but recomputing it mid-merge would record whatever the half-merged tree '
      + 'happens to compile to, and any file that GAINED errors would enter the ledger as merge '
      + 'noise instead of as red. check:generated refuses to auto-regenerate it for the same reason.',
  },
  {
    path: 'packages/spec/variant-docs.json',
    why: 'hand-maintained map of the schema variants; `check:variant-docs` audits it against the code, no generator.',
  },
  {
    path: 'packages/spec/src/migrations/registry.ts',
    why:
      'a MIXED file since #7297, and the mix is exactly why the driver must not own it. Its three '
      + 'append tables are now generated into marked regions from `src/migrations/entries/` (one file '
      + 'per entry), so a conflict INSIDE a region is resolved by `gen:migration-registry` and nothing '
      + 'else — `check:migration-registry` fails if it was resolved any other way, which is what stops '
      + "a resolution from silently dropping one side's retirement (#6957). But everything OUTSIDE the "
      + 'markers — the tables\' load-bearing doc comments and each step\'s `rationale` — is still '
      + 'hand-written, and the driver defers the WHOLE file to one side. Routing it here would let a '
      + "regeneration launder away a sibling's prose edit, trading the silent drop this change removed "
      + 'for a quieter one. So the prose conflict stays a human\'s, as it always was.',
  },
  {
    path: 'packages/spec/src/conversions/registry.ts',
    why:
      'hand-written source. Conflicts here are two conversions appended at the same spot — keeping '
      + 'both is usually right, but "usually" is a human judgement, not a merge rule. Deliberately NOT '
      + 'split per-entry alongside the migrations registry by #7297: the #6957 ruling names two append '
      + 'registries and the other one is `scripts/adr-anchors.json` (#7301). Splitting this one too is '
      + 'a follow-up with its own measurement, not a rider.',
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
