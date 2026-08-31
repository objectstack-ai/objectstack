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
 * The manifest that owns a row's `gen:`/`check:` names when the row does not say.
 *
 * Every row declared this implicitly until #13585, and the reconciliation read it
 * and nothing else — see `REGEN_ARTIFACTS` for what that cost.
 */
export const DEFAULT_OWNER = '@objectstack/spec';

/**
 * The ROOT manifest, by the name it gives itself.
 *
 * Spelled as a name rather than as a path so it reads the same way as any other
 * owner, and pinned against the real root `package.json` by
 * `git-merge-regen.mjs --self-test` so the two cannot drift apart silently. The
 * root is the one owner that is not a workspace member, which is why `ownerDir`
 * answers it directly instead of looking for it.
 */
export const ROOT_OWNER = '@objectstack/spec-monorepo';

/**
 * Artifacts the driver takes over. `check` proves currency, `gen` restores it.
 *
 * `owner` names the manifest that defines those two script names, and defaults to
 * `DEFAULT_OWNER`. `--self-test` verifies each name against THAT manifest, so a
 * renamed script fails loudly here instead of silently disarming a path.
 *
 * ## Why the owner is declared and not searched for (#13585)
 *
 * Until #13585 the verification read `packages/spec/package.json` alone, so an
 * artifact owned by ROOT tooling could not be registered at all: its `gen:`/
 * `check:` live in the root manifest, and the reconciliation reported them as
 * scripts that "no longer exist". That refusal was correct about the tree and
 * wrong about the world, and an author following it literally moves root tooling
 * into a package it does not belong to, purely to satisfy a lookup path.
 *
 * Widening the lookup to "resolve the name in any manifest" would have fixed the
 * refusal and left a worse seam behind, because the name is not what the other two
 * consumers need. The driver prints a regeneration command and the `pre-commit`
 * gate SPAWNS one, and both were bound to `packages/spec`; a row that resolved
 * somewhere else would be registered and unreconcilable — self-test green, while
 * the hook ran the gate in a directory that does not define it and refused the
 * commit forever. Measured before this field existed: `pnpm -s check:sdui-lockstep`
 * exits 254 (`Command not found`) in the gate's spawn directory and 0 at the repo
 * root. So the owner is a declaration all three consumers read, which is what keeps
 * the reconciliation two-way rather than merely permissive.
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
  //
  // `alsoWrittenBy` records the generator the paragraph above deliberately refuses
  // to name as `gen`, so the #13731 accounting can see that
  // `gen:authorable-surface-base` HAS a recorded disposition rather than reporting
  // it as a generator nobody has judged. It is a declaration for that reconciliation
  // only — no consumer runs it, which is the whole point of it not being `gen`.
  {
    path: 'packages/spec/authorable-surface.base.json',
    gen: 'gen:schema',
    check: 'check:authorable-surface',
    alsoWrittenBy: ['gen:authorable-surface-base'],
  },
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
  // #13646. The elevation census page — a generated `file:line` anchor table, and
  // the first row here owned by ROOT tooling rather than by `packages/spec` (the
  // owner field #13585 added exists for exactly this).
  //
  // ⚠️ The row is the FILE, not `content/docs/permissions/**`, and the difference
  // is safety rather than tidiness. Its routed sibling `content/docs/references/**`
  // is a whole generated tree; `content/docs/permissions/` is 22 hand-written prose
  // pages with ONE generated page among them, so the directory glob would hand 21
  // prose files to a driver that resolves to OURS — laundering away a sibling's
  // prose edit, which is the exact trade `migrations/registry.ts` is kept out of
  // this table for. The glob is recorded in NOT_DRIVER_MANAGED below.
  //
  // Why it belongs here at all: two PRs that each ran `--fix` against their own
  // tree write correct-for-themselves line numbers into the same rows, and the
  // merged tree's correct values equal NEITHER side — measured on #13625's merge,
  // where the five conflicted anchors resolved to `4408/5771/6019/6382/6575`
  // against branch `4407/5770/…` and main `4284/5647/…`. A text merge cannot reach
  // that answer from either input, so this is a deferral-and-regenerate shape.
  //
  // ⭐ And the deferral is safe in the direction that matters, which is the
  // question `os-regen-merge.sh` raises about every path here — a driver that
  // exits 0 trades a loud failure for a silent one unless something else still
  // reddens. Here something does, on every PR: `check-system-context-census.mjs`
  // runs in the required `Lint & Repo Gates` job with no `paths:` filter and on
  // `merge_group`, it re-derives the census from the tree rather than reading the
  // page back, and its scheduling is pinned by its own `--self-test` (#13646). The
  // driver is therefore the cheap half here and never the only signal.
  //
  // No `readsDist`/`readsSchemaTree`: the census is an AST walk over `src/`, so a
  // merged tree is the whole prerequisite. `gen` cannot launder a POPULATION change
  // either — `--fix` re-anchors a pure shift and REFUSES when a site arrived or
  // vanished, leaving the page untouched and the gate red (measured: exit 1, zero
  // anchors rewritten, `[declared-count] ruling-sites says 109, the census says 110`).
  {
    path: 'content/docs/permissions/system-context.mdx',
    gen: 'gen:system-context-census',
    check: 'check:system-context-census',
    owner: ROOT_OWNER,
  },
  // #13335 / #13731. The per-skill reference index — one row per `packages/spec`
  // source module, rendered whole by `gen:skill-refs`. Nine tracked files today,
  // matched as a SEGMENT glob so a tenth skill arrives routed instead of arriving
  // unrouted and silent (`entryForPath` learned the form for this row).
  //
  // The measured case is #13335's, and it is the textbook shape: PR #13262 and the
  // #13263 branch each regenerated `skills/objectstack-ui/references/_index.md`,
  // and `git merge origin/main` conflicted on adjacent rows —
  //
  //     - node_modules/@objectstack/spec/src/ui/report.zod.ts — Exports: ReportType, ...
  //     =======
  //     - node_modules/@objectstack/spec/src/ui/report.zod.ts — Report Type Enum
  //
  // Both sides are correct-for-themselves projections of their own tree, and the
  // merged tree's index equals NEITHER — the same "no text merge can reach the
  // answer" property that put the elevation census page above here. The correct
  // resolution #13335 records by hand (take either side, commit the merge,
  // regenerate, let `check:skill-refs` prove it) is exactly what this row plus
  // `os-regen-merge.sh` step 4 do mechanically.
  //
  // ⚠️ Routing is the CHEAP half and never the protection — the driver is LOCAL, so
  // it does nothing for a merge-queue rebuild (the header's standing warning). The
  // load-bearing half is server-side and already wired: `check:skill-refs` runs in
  // `lint.yml` (`typecheck-source-gates`) on `pull_request` AND `merge_group` with
  // no `paths:` filter, and it RE-DERIVES the index from the spec sources rather
  // than reading the file back — so it catches the silent case too, which is the
  // one that matters here (two branches whose rows do not overlap merge to exit 0
  // and a file describing neither side).
  //
  // No `readsDist`/`readsSchemaTree`: the generator walks `src/` directly.
  { path: 'skills/*/references/_index.md', gen: 'gen:skill-refs', check: 'check:skill-refs' },
  // #13731. The ADR-0081 react-tier contract, both halves. Generated WHOLE — the
  // markdown's frontmatter and its "do not edit by hand" banner are emitted by the
  // generator too, so there is no hand-written region for a deferral to launder,
  // which is the question this table exists to ask. A projection of the
  // `REACT_BLOCKS` definition in `@objectstack/spec/ui`, one section per block: two
  // PRs adding different blocks are a set union that git reports as a conflict.
  //
  // Same cheap-half caveat as its neighbour above, same answer: `check:react-blocks`
  // runs in `lint.yml` on `pull_request` and `merge_group`, re-deriving from the
  // definition, so the driver removes hand-merge rounds and is never the only signal.
  {
    path: 'skills/objectstack-ui/contracts/react-blocks.contract.json',
    gen: 'gen:react-blocks',
    check: 'check:react-blocks',
  },
  {
    path: 'skills/objectstack-ui/references/react-blocks.md',
    gen: 'gen:react-blocks',
    check: 'check:react-blocks',
  },
]);

/**
 * Files that LOOK generator-owned and deliberately are not. Recorded rather than
 * omitted: the dangerous mistake here is adding a path to `.gitattributes` because
 * a generator writes it, without asking whether recomputing it can *lose* a
 * decision a human made.
 *
 * Two optional fields, both added by #13731 and both read only by
 * `reconcileGenerators` in `git-merge-regen.mjs`:
 *
 *   `gen` / `owner` — the generator whose output this path is. Present where the
 *     accounting needs it, i.e. where the generator appears in no `REGEN_ARTIFACTS`
 *     row's `gen` and this entry is therefore the only record of its disposition.
 *     `owner` defaults to `DEFAULT_OWNER` exactly as a row's does, and it is part
 *     of the key: `gen:test-typecheck-debt` exists in THREE manifests writing three
 *     different ledgers, and declaring one of them must not silently account for
 *     the other two — that was 2 of the 11 unaccounted generators #13731 found.
 *
 *   `untracked` — this path is not in git at all (gitignored build output). The
 *     disposition is still recorded, because "git never merges it" is an answer to
 *     the question and its absence is not. Asserted rather than asserted-once: the
 *     self-test refuses if such a path becomes tracked, which is the moment the
 *     reason expires and a real disposition is owed.
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
    gen: 'gen:test-typecheck-debt',
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
    gen: 'gen:migration-registry',
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
    path: 'content/docs/permissions/**',
    why:
      'the DIRECTORY is not what #13646 routed, and recording that is the point of this ledger. '
      + '22 of its 23 pages are hand-written permissions prose; exactly one — `system-context.mdx`, '
      + 'declared above — is a generated anchor table. Routing the tree the way its sibling '
      + '`content/docs/references/**` is routed reads as symmetry and is not: that sibling is '
      + 'generated whole, this one would defer 21 prose files to OURS and lose the other side\'s '
      + 'edits silently. Route the generated FILE; leave the neighbours to text-merge, which is '
      + 'correct for prose and always was.',
  },
  // ── #13731: the remaining generators, one recorded disposition each ──────────
  {
    path: 'packages/client/test-typecheck-debt.json',
    gen: 'gen:test-typecheck-debt',
    owner: '@objectstack/client',
    why:
      'a SHRINK-ONLY ratchet — the same file, the same generator and the same trade as '
      + '`packages/spec/test-typecheck-debt.json` above, one package over. It is listed '
      + 'SEPARATELY rather than covered by its sibling on purpose: three manifests define '
      + '`gen:test-typecheck-debt` and each writes its own ledger, so one entry standing for '
      + 'all three would be a disposition nobody actually made for this file. Recomputing it '
      + 'mid-merge records whatever the half-merged tree compiles to, and a file that GAINED '
      + 'errors enters the ledger as merge noise instead of as red.',
  },
  {
    path: 'packages/rest/test-typecheck-debt.json',
    gen: 'gen:test-typecheck-debt',
    owner: '@objectstack/rest',
    why:
      'a SHRINK-ONLY ratchet — see `packages/client/test-typecheck-debt.json` directly above; '
      + 'same generator, same per-package ledger, same reason a merge must never recompute it.',
  },
  {
    path: 'packages/sdui-parser/objectui-lockstep.json',
    gen: 'gen:sdui-lockstep',
    owner: ROOT_OWNER,
    why:
      'a VENDORED RECORD OF ANOTHER REPOSITORY, and the only entry here that a merge could not '
      + "regenerate even if regenerating were right. `--update` re-records objectui's side of the "
      + 'sdui-parser lockstep and needs an objectui CHECKOUT to do it; a merge driver has no '
      + 'network, no build and no sibling checkout, so "recompute from the merged sources" names '
      + 'sources that are not in this tree at all. And the file is a human decision twice over — '
      + 'the pinned `.objectui-sha` records WHICH objectui revision someone ported to, which is an '
      + 'act of porting and not a projection of this repo. Regenerating it during a merge would '
      + 'either fail or silently re-point the lockstep at whatever checkout happened to be on disk, '
      + 'and a wrong answer here means the save gate and the renderer accept different grammars '
      + 'while every gate stays green.',
  },
  {
    path: 'skills/README.md',
    gen: 'gen:skill-docs',
    why:
      'MIXED, and the mix is the whole reason — the same trade `packages/spec/src/migrations/'
      + 'registry.ts` is kept out of the table for. `gen:skill-docs` rewrites ONLY the region '
      + 'between `BEGIN/END GENERATED: skills`: 17 of the file\'s 114 lines. The other 97 are '
      + 'hand-written prose about the bundle layout, and the driver defers the WHOLE file to OURS '
      + "— so routing it would let a regeneration launder away a sibling's prose edit, trading a "
      + 'merge conflict for a silent loss. `check:skill-docs` guards the generated region instead, '
      + 'and a prose conflict here is a human\'s, as it always was.',
  },
  {
    path: 'content/docs/ai/skills-reference.mdx',
    gen: 'gen:skill-docs',
    why:
      'MIXED, exactly as `skills/README.md` above — one spliced `BEGIN/END GENERATED: skills` '
      + 'block inside 267 lines of hand-written guide prose. Same generator, same deferral hazard, '
      + 'same answer: guard the block with `check:skill-docs`, leave the prose to text-merge.',
  },
  {
    path: 'packages/spec/json-schema/**',
    gen: 'gen:openapi',
    untracked: true,
    why:
      'GITIGNORED build output (`.gitignore:61`) — git never merges it, so it has no merge '
      + 'semantics to decide. Recorded rather than omitted because the tree LOOKS like the routed '
      + '`json-schema.manifest/**` next to it and invites the symmetry. It is also the tree '
      + '`readsSchemaTree` already warns about: a merge never delivers it, and whatever sits on '
      + 'disk describes one side. If it is ever committed, this entry expires and a real '
      + 'disposition is owed — the self-test refuses at that moment rather than after the merge '
      + 'that needed it.',
  },
  {
    path: 'sbom.json',
    gen: 'gen:sbom',
    untracked: true,
    why:
      'GITIGNORED build output (`.gitignore:73`), produced at release time from the manifests. '
      + 'Nothing merges it and no `check:` proves it current, so it has no place in either '
      + 'ledger — recorded so that "no disposition" is not confused with "not yet decided". Same '
      + 'expiry clause as the entry above: committing it turns this entry red.',
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

/**
 * The manifest name that owns an entry's `gen:`/`check:` scripts.
 *
 * Pure, and the single place the default is applied — a consumer that spelled
 * `entry.owner ?? '@objectstack/spec'` inline would be a second definition of the
 * default, and the one that wins would be whichever consumer the reader opened.
 *
 * @param {{ owner?: string }} entry
 * @returns {string}
 */
export function ownerOf(entry) {
  return entry.owner ?? DEFAULT_OWNER;
}

/**
 * The repo-relative directory an owner's `package.json` sits in, or `null` when no
 * such owner exists.
 *
 * Pure on purpose: it takes an ALREADY-enumerated workspace rather than reading one,
 * so this module keeps its "constants and pure functions, no top-level statement that
 * runs" shape (the property `check:entry-guard` relies on to leave it alone). Callers
 * pass `workspacePackages(REPO_ROOT)` from `workspace-enumerator.mjs`, which is the
 * repo's one parse of the workspace globs.
 *
 * `null` is a REFUSAL, never a skip: an owner nobody can resolve means a row whose
 * scripts were never verified, which is the state this whole reconciliation exists to
 * make impossible.
 *
 * @param {string} owner
 * @param {Array<{ dir: string, manifest: Record<string, unknown> }>} workspacePkgs
 * @returns {string | null}
 */
export function ownerDir(owner, workspacePkgs) {
  if (owner === ROOT_OWNER) return '.';
  const hit = workspacePkgs.find((p) => p?.manifest?.name === owner);
  return hit ? hit.dir : null;
}

/**
 * The pnpm invocation that runs `script` for `owner`, FROM THE REPO ROOT.
 *
 * One builder, because the string the driver PRINTS and the command the
 * `pre-commit` gate SPAWNS have to be the same command; #13585 is what happens when
 * a lookup and its consumers disagree about which package a row belongs to. The root
 * manifest takes no `--filter`: it is not a workspace member, and `pnpm <script>` at
 * the root is how its scripts run.
 *
 * @param {string} owner
 * @param {string} script
 * @param {{ silent?: boolean }} [options] `silent` adds `-s`, for a spawn rather than advice
 * @returns {string}
 */
export function ownerRunCommand(owner, script, { silent = false } = {}) {
  const s = silent ? ' -s' : '';
  return owner === ROOT_OWNER ? `pnpm${s} ${script}` : `pnpm${s} --filter ${owner} ${script}`;
}

/**
 * Does `p` match a table path, read the way **git** reads the same string in
 * `.gitattributes`?
 *
 * The table path and the `.gitattributes` pattern are literally the same string —
 * `reconcileAttributes` holds them equal — so the two readers have to agree on what
 * it MEANS, not merely on its bytes. Until #13731 they did not: the matcher below
 * understood a trailing `/**` and exact equality and nothing else, so a pattern git
 * matches happily (`skills/*` + a segment) would reconcile green and then be REFUSED
 * by the driver at merge time, with the refusal blaming an absent table row. That is
 * this card's own failure mode one level down — a gate green over a case it cannot
 * see — and it surfaces during a merge, which is the worst moment to learn it.
 *
 * Two forms, both matching git's gitattributes semantics for a pattern containing a
 * slash (anchored at the repo root):
 *
 *   `a/b/**`  — the subtree under `a/b/`
 *   a slash-star-slash form   — one path SEGMENT; the star never crosses a `/`, as git has it
 *
 * `git-merge-regen.mjs --self-test` pins the agreement against `git check-attr`
 * itself rather than against this comment, so a future divergence is measured.
 */
function pathMatches(pattern, p) {
  if (pattern.endsWith('/**')) return p.startsWith(pattern.slice(0, -2));
  if (!pattern.includes('*')) return pattern === p;
  const rx = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${rx}$`).test(p);
}

/** Resolve the entry that owns a path, or undefined. Handles the `**` and `*` forms. */
export function entryForPath(p) {
  return REGEN_ARTIFACTS.find((e) => pathMatches(e.path, p));
}
