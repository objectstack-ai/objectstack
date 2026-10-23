// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 580 — spawns the real producer once per single-cause fixture: every case runs the real schema generator (build-schemas.ts --check) in its own sandbox git tree, one fixture per cause; measured 2026-10-23 on its first CI reading after #25372 split build-schemas-check-mode.test.ts (run 39963105499, Test Core, head dce4c6406): 457.69 s x 1.25, rounded up; one reading only, its wall tracks the run's load, so re-measure once the window has more
//
// The three git-topology blocks, each on its own sandbox (#9068): --update-base moves
// the anchor forward or not at all (#5370); the drift notice names the direction it
// measured (#5847); a shallow checkout re-anchors the deletion gate (#6452).
//
// One of the `build-schemas-check-mode.*.test.ts` files (#25372 split the one
// file so the repo project's workers run its blocks in parallel). The family's
// header — what `--check` pins and why every case runs in a sandbox git tree —
// and the shared sandbox, helpers and constants live in
// `build-schemas-check-mode.fixture.ts`.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_DEFS_BY_MAJOR } from '../src/migrations/registry';
import { AUTHORABLE_SURFACE_DIR_NAME, SCHEMA_MANIFEST_DIR_NAME } from './lib/sharded-artifacts';
import {
  createSandbox,
  git,
  gitStatusIn,
  pristine,
  pristineSurface,
  readSurfaceBase,
  releaseSandbox,
  run,
  sandbox,
  seedBase,
  seedManifest,
  seedSurface,
  seedSurfaceBase,
  SPAWN_TIMEOUT_MS,
  surfaceBasePath,
  useSharedSandbox,
} from './build-schemas-check-mode.fixture';

// The repo-root `scripts/` every sandbox here symlinks in, and the generator
// imports from (#16175): an input from outside this package, so it is named in
// this file — `check:cross-package-test-inputs` reads a test file's own source,
// not the fixture module it imports (#25372).
const ROOT_SCRIPTS = fileURLToPath(new URL('../../../scripts', import.meta.url));

useSharedSandbox(ROOT_SCRIPTS);

// ─────────────────────────────────────────────────────────────────────────────
// #5370 — the anchor moves FORWARD, or it does not move.
//
// #5358 answered WHEN the anchor may be written (only in `--update-base`). It did
// not answer WHERE FROM, and the answer was still "wherever `merge-base(HEAD,
// origin/main)` lands" — which is not always ahead of the anchor already
// committed. The reported shape is a stopped merge: until it is committed, HEAD is
// the branch tip from BEFORE the merge, so the merge base is the branch's OLD fork
// point rather than the main tip being merged in, and re-anchoring there rolls
// `baseRev` BACKWARDS. Measured on the #5312 sync relay: `1c3da1f` → `5aae790`,
// returning the 109 keys #5321 had just retired.
//
// The reason this needs a refusal rather than a warning is that the regressed file
// is INDISTINGUISHABLE from a good one by every property the gates check. The old
// rev is a genuine origin/main ancestor and the keys written are that commit's
// surface verbatim, so `verifyCommittedSurfaceBase`, `check:authorable-surface`
// and the pre-commit os-regen guard are all green before and after. Nothing
// anywhere reports it; the only trace is a reverse `baseRev` move in the diff,
// which reads like #4650's attack shape and was written by the generator.
//
// So both guards are refusals, and each pins its own half here: MERGE_HEAD present
// is refused before a single schema is generated, and any re-anchor whose new rev
// is not a descendant of the committed one is refused at the write.
describe('build-schemas.ts — --update-base moves the anchor forward or not at all (#5370)', () => {
  /** Absent from `older` and from `tip` — the key a backwards move would drop. */
  const FORKED_KEY = 'data/Object:label';
  /** Absent from `older` and from `tip`, present at `mainTip` — so the remedy WRITES. */
  const LANDED_KEY = 'data/Object:description';

  /** The branch's fork point: upstream, and behind the committed anchor. */
  let older: string;
  /** The commit the anchor authentically mirrors — ahead of `older`, on origin/main. */
  let tip: string;
  /** origin/main. Ahead of `tip`, so the anchor is authentic and merely lags. */
  let mainTip: string;
  let anchorAtTip: string;

  const mergeHeadFile = (): string =>
    path.resolve(sandbox, git('rev-parse', '--git-path', 'MERGE_HEAD'));

  /** This block's own fixture repo (#9068). */
  let ownSandbox: string;

  beforeAll(() => {
    const keys = pristineSurface;
    for (const k of [FORKED_KEY, LANDED_KEY]) {
      expect(keys, `${k} is no longer in the baseline — pick another live key`).toContain(k);
    }
    // Its own repo, because of what the cases below do to one: fork a branch,
    // reset it every `beforeEach`, leave a merge uncommitted, and truncate
    // history with a hand-written `.git/shallow`. In a shared repo that surgery
    // is the neighbouring blocks' problem too (#9068).
    ownSandbox = createSandbox('build-schemas-5370-');
  });

  afterAll(() => releaseSandbox(ownSandbox));

  beforeEach(() => {
    seedManifest((s) => s);
    // Three upstream commits, linear, each one key richer than the last. The
    // anchor mirrors the MIDDLE one: authentic (its keys ARE that commit's
    // baseline), an ancestor of origin/main, and lagging — the ordinary state of
    // every checkout between two surface changes.
    older = seedBase((s) => s.filter((k) => k !== FORKED_KEY && k !== LANDED_KEY));
    tip = seedBase((s) => s.filter((k) => k !== LANDED_KEY));
    seedBase((s) => s);
    seedSurface((s) => s);
    anchorAtTip = seedSurfaceBase(tip, (k) => k.filter((x) => x !== LANDED_KEY));
    git('add', AUTHORABLE_SURFACE_DIR_NAME, 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: anchor at the middle upstream commit');
    mainTip = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', mainTip);

    // HEAD forks at `older` and then makes main's own surface change BYTE FOR
    // BYTE. Two consequences, both wanted: `merge-base(HEAD, origin/main)` is
    // `older` (behind the anchor), and merging main in is conflict-free and stages
    // nothing — so `git status` staying empty across a run means the run wrote
    // nothing, with no merge noise to subtract.
    git('checkout', '-q', '-B', 'issue-5370-fork', older);
    seedSurface((s) => s);
    seedSurfaceBase(tip, (k) => k.filter((x) => x !== LANDED_KEY));
    git('add', AUTHORABLE_SURFACE_DIR_NAME, 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: branch work, forked before the anchor advanced');
    expect(git('status', '--porcelain', '-uno')).toBe('');
    expect(git('merge-base', 'HEAD', mainTip)).toBe(older);
  });

  afterEach(() => {
    if (fs.existsSync(mergeHeadFile())) git('merge', '--abort');
    git('checkout', '-q', '-f', 'main');
    git('update-ref', 'refs/remotes/origin/main', mainTip);
  });

  it(
    'refuses while a merge is uncommitted — before generating anything — and the commit-first remedy works',
    { timeout: SPAWN_TIMEOUT_MS * 3 },
    () => {
      git('merge', '--no-commit', '--no-ff', mainTip);
      expect(fs.existsSync(mergeHeadFile()), 'fixture is not actually mid-merge').toBe(true);
      expect(git('status', '--porcelain', '-uno')).toBe('');

      const refused = run(['--update-base']);

      expect(refused.status).toBe(1);
      expect(refused.output).toContain('refuses to run mid-merge (#5370)');
      expect(refused.output).toContain('Commit the merge first');
      expect(refused.output).toContain('gen:authorable-surface-base');
      // Refused before the ~1600-schema generation, like `--check --update-base`.
      expect(refused.output).not.toContain('Generating JSON Schemas');
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');

      // The guard is narrow: a plain build mid-merge is NOT refused. #5807 took the
      // anchor out of every build, which is why `scripts/regen-artifacts.mjs` can
      // still prescribe `gen:schema` after a merge — refusing that too would break
      // the driver's own deferred regeneration.
      const build = run([]);
      expect(build.status).toBe(0);
      expect(build.output).not.toContain('#5370');
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');

      // Now the prescription, literally: commit the merge, then re-anchor. HEAD's
      // merge base with origin/main is `mainTip` once the merge is a commit, so the
      // move is forward and the write lands — the refusal has a working remedy, not
      // just a rule.
      git('commit', '-q', '--no-edit');
      const reanchored = run(['--update-base']);

      expect(reanchored.status).toBe(0);
      expect(reanchored.output).toContain('⚓');
      const doc = JSON.parse(readSurfaceBase()) as { baseRev: string; keys: string[] };
      expect(doc.baseRev).toBe(mainTip);
      expect(doc.keys).toContain(LANDED_KEY);
      expect(doc.keys).toEqual(pristineSurface);
    },
  );

  it(
    'refuses a re-anchor whose new rev is an ancestor of the committed one, and writes nothing',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // No merge in sight: the same backwards move reached by ordinary means — a
      // branch forked before the anchor advanced (a `git checkout origin/main --
      // <anchor>` or a driver resolution to THEIRS gets here too). MERGE_HEAD is
      // not the defect, it is one way in; the write is where the defect is decided.
      const { status, output } = run(['--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('would move authorable-surface.base.json BACKWARDS (#5370)');
      expect(output).toContain(tip.slice(0, 12)); // committed baseRev
      expect(output).toContain(older.slice(0, 12)); // what the run resolved
      expect(output).not.toContain('⚓');
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');
    },
  );

  it(
    'refuses rather than guesses when a NEGATIVE ancestry answer cannot be trusted — a shallow checkout',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Truncating history AT `mainTip` cuts the walk that would reach the anchor's
      // own commit, so `merge-base --is-ancestor tip mainTip` reports "not an
      // ancestor" about a commit that plainly is one — the shape that failed #5358's
      // first CI run, and the live state of every agent container today (the
      // anchor's baseRev sits in `.git/shallow` as its own grafted root).
      //
      // The move here is genuinely FORWARD, so this is the guard's own cost, stated
      // rather than hidden: where the answer is unusable it refuses, and the message
      // has to name the reason and the remedy instead of the backwards verdict. The
      // opposite disposition — trusting the 1 — would fail every re-anchor in a
      // shallow clone with an accusation of a backwards move that never happened.
      fs.writeFileSync(path.join(sandbox, '.git', 'shallow'), `${mainTip}\n`);
      try {
        expect(git('rev-parse', '--is-shallow-repository')).toBe('true');

        const { status, output } = run(['--update-base']);

        expect(status).toBe(1);
        expect(output).toContain('cannot establish which way');
        expect(output).toContain('shallow checkout');
        // The reason it refuses is truncation, NOT a backwards move — a message
        // that said otherwise would send the reader to fix a history that is fine.
        expect(output).not.toContain('BACKWARDS');
        expect(output).toContain('git fetch --unshallow origin');
        expect(output).not.toContain('⚓');
        expect(readSurfaceBase()).toBe(anchorAtTip);
      } finally {
        fs.rmSync(path.join(sandbox, '.git', 'shallow'), { force: true });
      }
    },
  );

  it(
    'an origin/main rewound BEHIND the anchor is caught one gate earlier, by the authenticity check',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Recorded because it is the fixture this guard reads like it needs and does
      // not: pointing origin/main at an ancestor of the committed `baseRev` never
      // reaches the write at all. `verifyCommittedSurfaceBase` runs first and the
      // anchor is no longer an ancestor of origin/main, so the run dies on
      // authenticity — a different fact, with a different remedy. The backwards move
      // the monotonicity guard exists for is the one where BOTH revs are authentic
      // (the case above), which is precisely why nothing else could see it.
      git('update-ref', 'refs/remotes/origin/main', older);

      const { status, output } = run(['--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('NOT an ancestor of');
      expect(output).toContain(tip.slice(0, 12));
      expect(output).not.toContain('#5370');
      expect(readSurfaceBase()).toBe(anchorAtTip);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5847 — the drift notice names the direction it MEASURED.
//
// The anchor and the baseline a build resolves disagree constantly, and the
// notice that reports it used to have one sentence for both directions:
// "trails the baseline at <rev> by <n> key(s)", with `n` counted as
// `resolved keys ∖ anchor keys`. That count is only the size of the gap when the
// anchor is the OLDER of the two. When the committed anchor is newer — the
// resolved baseline's keys are then a subset of the anchor's — `n` is 0 and the
// line reads "trails the baseline at 9ce056a879ef by 0 key(s)": the direction
// backwards, and the one number that could have contradicted it zeroed out.
//
// Both states are ordinary. #5370 catalogues the two ways in (a build during an
// uncommitted merge, and a branch that forked before the anchor advanced), and
// since #5370 `--update-base` REFUSES in exactly this state and explains the
// direction correctly — so one situation was being described by two of our own
// messages in contradictory language. Nothing about the gate changes here: same
// exit code, same (absent) writes, same verdicts. Only the sentence.
//
// The direction is decided by the SAME `merge-base --is-ancestor` reading the
// re-anchor guard decides on (`probeAncestry`), never by a second key
// subtraction — a subtraction is what said the wrong thing in the first place,
// and two independent determinations of one direction is how the two answers
// drift apart again.
describe('build-schemas.ts — the drift notice names the direction it measured (#5847)', () => {
  /** In `tip` and `mainTip`, absent from `older`: the key the anchor holds and the resolved baseline does not. */
  const AHEAD_KEY = 'data/Object:label';
  /** Only in `mainTip`: what origin/main added after the anchor. */
  const LANDED_KEY = 'data/Object:description';
  /** A key in a DIFFERENT shard, so the unordered fixture's two sides merge without conflict. */
  const UI_KEY = 'ui/View:form';

  /** The branch's fork point: upstream, and behind the committed anchor. */
  let older: string;
  /** Ahead of `older`, on origin/main — what the AHEAD fixture's anchor mirrors. */
  let tip: string;
  /** origin/main, ahead of both. */
  let mainTip: string;

  /** `git()` throws on a non-zero exit, which is exactly what a NEGATIVE ancestry
   *  probe returns — so fixture validation needs its own non-throwing runner. */
  const isAncestor = (a: string, b: string): boolean =>
    gitStatusIn(sandbox, 'merge-base', '--is-ancestor', a, b) === 0;

  const shallowFile = (): string => path.join(sandbox, '.git', 'shallow');

  /** This block's own fixture repo (#9068). */
  let ownSandbox: string;

  beforeAll(() => {
    for (const k of [AHEAD_KEY, LANDED_KEY, UI_KEY]) {
      expect(pristineSurface, `${k} is no longer in the baseline — pick another live key`).toContain(k);
    }
    // Own repo: these cases fork, merge and truncate history the same way #5370
    // does, and one of them leaves a `.git/shallow` behind for its `afterEach`
    // to clear — a window in which a stray gc prunes everything behind the graft
    // point. Containing that to this block is what #9068 bought.
    ownSandbox = createSandbox('build-schemas-5847-');
  });

  afterAll(() => releaseSandbox(ownSandbox));

  beforeEach(() => {
    seedManifest((s) => s);
    // Three upstream commits, linear, each one key richer than the last — the
    // same ladder #5370 uses, because these are the same two states it named.
    older = seedBase((s) => s.filter((k) => k !== AHEAD_KEY && k !== LANDED_KEY));
    tip = seedBase((s) => s.filter((k) => k !== LANDED_KEY));
    mainTip = seedBase((s) => s);
    seedSurface((s) => s);
  });

  afterEach(() => {
    fs.rmSync(shallowFile(), { force: true });
    git('checkout', '-q', '-f', 'main');
    // Hand `main` back current and CLEAN: an anchor that mirrors main's own tip,
    // so the NEXT CASE here starts from a tree with no drift of ours in it.
    // (Since #9068 this repo is the block's own, so the hand-off it owes is to
    // its own siblings — no describe after this one ever sees this tree.)
    seedSurface((s) => s);
    seedSurfaceBase(git('rev-parse', 'HEAD'), (k) => k);
    git('add', AUTHORABLE_SURFACE_DIR_NAME, 'authorable-surface.base.json');
    git('commit', '-q', '--allow-empty', '-m', 'fixture: restore a current anchor on main');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  });

  /** Commit the anchor — and the surface the fork restored alongside it, since a
   *  `checkout` to an older commit takes the shards back with it — so that
   *  `git status` staying empty across a run can mean "this run wrote nothing". */
  function commitAnchor(baseRev: string, mutate: (keys: string[]) => string[]): string {
    const bytes = seedSurfaceBase(baseRev, mutate);
    git('add', AUTHORABLE_SURFACE_DIR_NAME, 'authorable-surface.base.json');
    git('commit', '-q', '-m', `fixture: anchor at ${baseRev.slice(0, 12)}`);
    expect(git('status', '--porcelain', '-uno')).toBe('');
    return bytes;
  }

  it(
    'says the anchor TRAILS when it is the older of the two, and names both revs and both deltas',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The ordinary lag: HEAD is on main, the anchor mirrors an older upstream
      // commit. This direction was never wrong — what it lacked was the anchor's
      // own rev (so the reader could see WHICH two commits disagree) and the
      // reverse delta.
      const anchorAtOlder = commitAnchor(older, (k) =>
        k.filter((x) => x !== AHEAD_KEY && x !== LANDED_KEY),
      );
      expect(isAncestor(older, mainTip)).toBe(true);

      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(anchorAtOlder);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      expect(output).toContain(`trails the baseline at ${mainTip.slice(0, 12)}: it mirrors the older`);
      expect(output).toContain(`${older.slice(0, 12)}, and they differ by 2 key(s) only that baseline has`);
      expect(output).toContain('not an error');
      expect(output).toContain('gen:authorable-surface-base');
      expect(output).not.toContain('AHEAD of');
      expect(output).not.toMatch(/by 0 key\(s\)/);
      expect(output).not.toContain('⚓');
    },
  );

  it(
    'says the anchor is AHEAD when it is the newer of the two — never "trails … by 0 key(s)"',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // THE regression. The anchor mirrors `tip`; HEAD forked at `older`, so the
      // baseline this build resolves is `older` and its keys are a strict SUBSET
      // of the anchor's. The old subtraction therefore counted 0 and the line
      // claimed the file trailed a baseline it is a descendant of.
      git('checkout', '-q', '-B', 'issue-5847-ahead', older);
      seedSurface((s) => s);
      const anchorAtTip = commitAnchor(tip, (k) => k.filter((x) => x !== LANDED_KEY));
      expect(git('merge-base', 'HEAD', mainTip)).toBe(older);
      expect(isAncestor(older, tip)).toBe(true);
      expect(isAncestor(tip, older)).toBe(false);

      const { status, output } = run([]);

      // Exit code and files are the half that must NOT move: this is a sentence
      // fix, and a diagnostic that starts deciding things is a different change.
      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      expect(output).toContain('is AHEAD of the baseline this build resolved');
      expect(output).toContain(
        `${tip.slice(0, 12)}, a DESCENDANT of the merge base ${older.slice(0, 12)} that HEAD resolves to`,
      );
      expect(output).toContain('they differ by 1 key(s) only the anchor has');
      // The two halves of the defect, pinned as negatives so a future edit cannot
      // reintroduce either one without this going red.
      expect(output).not.toContain('trails the baseline');
      expect(output).not.toMatch(/by 0 key\(s\)/);
      expect(output).not.toContain('⚓');
    },
  );

  it(
    'claims NO direction in a shallow checkout, and names truncation as the reason',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // CI's own typecheck job is a shallow checkout, and so is every agent
      // container — so this is the common environment, not an exotic one.
      //
      // Truncation moves TWO things here, and the second was a surprise worth
      // writing down: `merge-base HEAD origin/main` itself fails once the walk is
      // cut, so `resolveSurfaceBase` has to anchor the baseline somewhere else.
      // The pair being compared is therefore the committed anchor against THAT
      // baseline, not against the fork point — and the ancestry between them is
      // exactly what a grafted history cannot answer, in either direction.
      //
      // The old line printed "trails the baseline at <rev> by 1 key(s)" here,
      // which happens to be TRUE of the untruncated history — and that is the
      // point: it was never measured, it was assumed, and one fixture over the
      // same assumption printed the exact opposite of the truth. Declining is the
      // same disposition #5370 already took for the write.
      //
      // #24359 re-based this fixture without changing its subject. Where
      // `merge-base` cannot answer at all, a shallow run now anchors on the
      // rev the TREE records, so it resolves exactly the committed anchor and
      // there is no drift left to describe. The notice's shallow arm is the
      // other truncated state: `merge-base` still answers (the agent container
      // this repo is worked in is one), while the anchor's own commit sits in
      // `.git/shallow` as a grafted root. Here origin/main reaches the fork
      // point `older` along a second parent, so the merge base is walkable,
      // and `tip` — the rev the anchor names — is grafted, so neither ancestry
      // probe between the two can answer and the notice must still decline.
      seedSurfaceBase(older, (k) => k.filter((x) => x !== AHEAD_KEY && x !== LANDED_KEY));
      git('add', 'authorable-surface.base.json');
      git('commit', '-q', '-m', 'fixture: main records its anchor at the older baseline');
      const mainHead = git('rev-parse', 'HEAD');
      const mainMerge = git(
        'commit-tree', `${mainHead}^{tree}`, '-p', mainHead, '-p', older,
        '-m', 'fixture: origin/main also reaches the fork point along a second parent',
      );
      git('update-ref', 'refs/remotes/origin/main', mainMerge);

      git('checkout', '-q', '-B', 'issue-5847-shallow', older);
      seedSurface((s) => s);
      const anchorAtTip = commitAnchor(tip, (k) => k.filter((x) => x !== LANDED_KEY));
      fs.writeFileSync(shallowFile(), `${tip}\n`);
      expect(git('rev-parse', '--is-shallow-repository')).toBe('true');
      expect(git('merge-base', 'HEAD', mainMerge), 'the merge base must still answer here').toBe(older);

      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      expect(output).toContain('differs from the baseline this build resolved');
      expect(output).toContain(
        `${tip.slice(0, 12)}, that baseline is at ${older.slice(0, 12)}, and they differ by ` +
          `1 key(s) only the anchor has`,
      );
      expect(output).toContain(
        'shallow checkout — a "not an ancestor" answer is not usable about a truncated history',
      );
      // A direction nobody could establish is never asserted — in EITHER wording.
      expect(output).not.toContain('trails the baseline');
      expect(output).not.toContain('AHEAD of');
      expect(output).not.toMatch(/by 0 key\(s\)/);
    },
  );

  it(
    'claims NO direction when the two revs are genuinely unordered',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Two authentic origin/main ancestors that sit on opposite sides of a merge:
      // each passes every check the gate makes about a single rev, and neither is
      // an ancestor of the other. There is no direction to report, so the notice
      // reports the delta and says so — the disposition `probeAncestry`'s
      // `unknown` gets here, as against the re-anchor guard's fail-closed refusal.
      const base = seedBase((s) => s);

      git('checkout', '-q', '-B', 'issue-5847-side-a', base);
      seedSurface((s) => s.filter((k) => k !== AHEAD_KEY));
      git('add', AUTHORABLE_SURFACE_DIR_NAME);
      git('commit', '-q', '-m', 'fixture: one side of the merge (data shard)');
      const sideA = git('rev-parse', 'HEAD');

      git('checkout', '-q', '-B', 'issue-5847-side-b', base);
      seedSurface((s) => s.filter((k) => k !== UI_KEY));
      git('add', AUTHORABLE_SURFACE_DIR_NAME);
      git('commit', '-q', '-m', 'fixture: other side of the merge (ui shard)');
      const sideB = git('rev-parse', 'HEAD');

      // Conflict-free by construction: the two sides touch different shards.
      git('merge', '--no-ff', '-q', '-m', 'fixture: merge the two sides', sideA);
      const merged = git('rev-parse', 'HEAD');
      git('update-ref', 'refs/remotes/origin/main', merged);
      expect(isAncestor(sideA, merged)).toBe(true);
      expect(isAncestor(sideA, sideB)).toBe(false);
      expect(isAncestor(sideB, sideA)).toBe(false);

      // HEAD forks on side B; the anchor authentically mirrors side A.
      git('checkout', '-q', '-B', 'issue-5847-unordered', sideB);
      seedSurface((s) => s);
      const anchorAtSideA = commitAnchor(sideA, (k) => k.filter((x) => x !== AHEAD_KEY));
      expect(git('merge-base', 'HEAD', merged)).toBe(sideB);

      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(anchorAtSideA);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      expect(output).toContain('differs from the baseline this build resolved');
      expect(output).toContain(
        `${sideA.slice(0, 12)}, that baseline is at ${sideB.slice(0, 12)}, and they differ by ` +
          `1 key(s) only that baseline has, 1 only the anchor has`,
      );
      expect(output).toContain('neither commit is an ancestor of the other');
      expect(output).not.toContain('trails the baseline');
      expect(output).not.toContain('AHEAD of');
      expect(output).not.toMatch(/by 0 key\(s\)/);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #6452 — a truncated history moves the ANCHOR, never the verdict.
//
// `merge-base HEAD origin/main` cannot answer in a shallow checkout, and the old
// fallback anchored on origin/main's TIP. Under a tip anchor "main added a key
// after this branch forked" and "this branch deleted a key" are the SAME fact,
// so the gate reported the first as the second: #6359 measured PR #6356 — which
// touched no packages/spec file at all — being told it had deleted
// `ui/BulkActionDef:requiredPermissions`, a key main had just added. Nothing
// guarded that path (the calling block carries no `if (CHECK)`) and its verdict
// is `process.exit(1)`, so it is every `gen:schema` in a shallow job, not one
// gate in one mode.
//
// The two obvious dispositions were both refused before this one was chosen:
// reporting "unverified" instead of adjudicating is the #4650 bypass in every
// shallow job at once (`resolveSurfaceBase`'s own doc comment says so), and
// erroring on the CI configuration paints that whole set of jobs red. So the
// anchor moves and the verdict does not: the gate still runs, and a key that
// existed at the anchored rev and is gone now is still caught.
//
// What these cases pin, and why each one can go red:
//
//   1. the false red is gone — same tree, same truncation, main's addition is
//      no longer this branch's deletion;
//   2. the gate did NOT weaken — a real deletion is still red, and it names the
//      deleted key rather than main's addition;
//   3. the baseline's keys come from GIT at that commit, never from the anchor
//      FILE. This is the acceptance criterion that cannot be assumed: if the
//      resolution took the file's own `keys`, `verifyCommittedSurfaceBase` would
//      hit its `rev === resolved.rev` fast path and compare the anchor against
//      itself, so a line shed from it would pass. The fixture sheds one;
//   4. the anchor is the one the TREE records (#24359). A PR can point `baseRev`
//      at one of its OWN commits, and a truncated history cannot refute that by
//      walking — so the shallow run uses it, and the forged rev is refused where
//      history IS walkable, the path this repository's own PR gate runs
//      (`fetch-depth: 0`). Both halves are pinned: the shallow run's anchor, and
//      the walkable run's refusal. Before #24359 the shallow run swapped in the
//      rev origin/main's anchor named, which made the verdict about a commit a
//      function of wherever main pointed;
//   5. with no anchor the tree can read, the run REFUSES — it never anchors on
//      the tip again. What origin/main does or does not record is irrelevant;
//   6. the acceptance #24359 is about: the same commit, under a main that only
//      moved on and under a main that re-anchored past it, gets the same verdict;
//   7. and that verdict keeps its teeth: a schema the commit's own anchor
//      recorded and the build no longer emits is red under either main — where
//      the old run, under the re-anchored main, missed it and named one of
//      main's additions instead.
describe('build-schemas.ts — a shallow checkout re-anchors the deletion gate, it does not accuse (#6452)', () => {
  /** Only in the baseline at origin/main's TIP: what main added after this branch forked. */
  const MAIN_ADDED_KEY = 'data/Object:zzAddedOnMainAfterTheFork6452';
  /** In the baseline at the ANCHORED rev too, so its absence is a real deletion. */
  const BRANCH_DELETED_KEY = 'data/Object:zzDeletedByThisBranch6452';
  /** A live key this build really emits — shed from the anchor FILE by case 3. */
  const SHED_KEY = 'data/Object:label';
  /** A schema only main publishes, AFTER the commit under test (cases 6–7). */
  const MAIN_ADDED_DEF = 'ui/ZzzPublishedOnMainAfterTheCommit';
  /** A schema the commit's own anchor recorded and the commit stopped emitting (case 7). */
  const ANCHOR_ONLY_DEF = 'ui/ZzzPublishedAtTheAnchorOnly';
  const NO_REGISTERED_REMOVAL = 'schema(s) left the published set with no registered removal';

  const shallowFile = (): string => path.join(sandbox, '.git', 'shallow');

  /** `git()` throws on a non-zero exit, which is what the fixture guards expect. */
  const mergeBaseFails = (rev: string): boolean =>
    gitStatusIn(sandbox, 'merge-base', 'HEAD', rev) !== 0;

  /** This block's own fixture repo (#9068). */
  let ownSandbox: string;

  beforeAll(() => {
    expect(pristineSurface, `${SHED_KEY} is no longer in the baseline — pick another live key`).toContain(
      SHED_KEY,
    );
    const registeredDefs = Object.values(RETIRED_DEFS_BY_MAJOR).flat();
    for (const def of [MAIN_ADDED_DEF, ANCHOR_ONLY_DEF]) {
      expect(pristine, `${def} is a real published def — pick a phantom`).not.toContain(def);
      expect(registeredDefs, `${def} is registered for real — pick an unregistered phantom`).not.toContain(def);
    }
    // Own repo: EVERY case here marks the repo shallow (`forkBranch` writes
    // `.git/shallow`), which is the widest such window in the file (#9068).
    ownSandbox = createSandbox('build-schemas-6452-');
  });

  afterAll(() => releaseSandbox(ownSandbox));

  /**
   * The upstream ladder every case forks from: a fork point, main's own anchor
   * committed ON MAIN at it, then a main that moves ahead and ADDS a key.
   *
   * Committing the anchor on main is what makes these fixtures model CI rather
   * than a laboratory: origin/main's copy of that file is the only statement
   * about which rev the anchor names that a PR cannot rewrite, and it is exactly
   * what a `--depth=1` fetch of main still carries.
   */
  function seedUpstream(baseKeys: (keys: string[]) => string[]): {
    forkBase: string;
    anchored: string;
    mainTip: string;
  } {
    seedManifest((s) => s);
    const forkBase = seedBase(baseKeys);
    seedSurfaceBase(forkBase, baseKeys);
    git('add', 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: main anchors at the fork point');
    const anchored = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', anchored);
    const mainTip = seedBase((s) => [...baseKeys(s), MAIN_ADDED_KEY].sort());
    return { forkBase, anchored, mainTip };
  }

  /** Fork at an upstream commit and truncate history the way CI's checkout does. */
  function forkBranch(name: string, at: string, mainTip: string): void {
    git('checkout', '-q', '-B', name, at);
    // The worktree carries what this build emits, so every case below is judged
    // on its baseline rather than on artifact staleness.
    seedSurface((s) => s);
    fs.writeFileSync(shallowFile(), `${mainTip}\n`);
    expect(git('rev-parse', '--is-shallow-repository')).toBe('true');
    expect(mergeBaseFails(mainTip), 'the fixture is not truncated — merge-base still answers').toBe(true);
  }

  afterEach(() => {
    fs.rmSync(shallowFile(), { force: true });
    git('checkout', '-q', '-f', 'main');
    // Hand `main` back current and CLEAN, so the NEXT CASE here starts from a
    // tree with no fixture of ours in it (since #9068 this repo is the block's
    // own, so that hand-off is to its siblings) — the surface first, then an
    // anchor that names the commit just made, so what is left behind is authentic
    // by construction rather than by luck (one case here removes main's anchor
    // outright, and the next describe reads whatever this leaves).
    seedSurface((s) => s);
    git('add', AUTHORABLE_SURFACE_DIR_NAME);
    git('commit', '-q', '--allow-empty', '-m', 'fixture: restore the pristine surface on main');
    seedSurfaceBase(git('rev-parse', 'HEAD'), (k) => k);
    git('add', 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: restore a current anchor on main');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  });

  it(
    'no false red: a key main added after the fork is not reported as this branch deleting it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { forkBase, anchored, mainTip } = seedUpstream((s) => s);
      forkBranch('issue-6452-no-false-red', anchored, mainTip);

      const { status, output } = run(['--check']);

      // The anchor moved, and the line says which rev and on whose authority.
      expect(output).toContain(`anchors on ${forkBase.slice(0, 12)} rather than on`);
      expect(output).toContain("it is the rev this tree's authorable-surface.base.json records");
      expect(output).not.toContain('no merge base is walkable here');
      // The defect itself: under the tip anchor this run exited 1 naming
      // MAIN_ADDED_KEY as an unproven deletion.
      expect(output).not.toContain('deleted without proof');
      expect(output).not.toContain(MAIN_ADDED_KEY);
      expect(status).toBe(0);
    },
  );

  it(
    'the gate does not weaken: a genuine deletion is still red under the same truncation',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { forkBase, anchored, mainTip } = seedUpstream((s) => [...s, BRANCH_DELETED_KEY].sort());
      forkBranch('issue-6452-real-deletion', anchored, mainTip);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`anchors on ${forkBase.slice(0, 12)} rather than on`);
      expect(output).toContain('1 authorable baseline line(s) were deleted without proof (#4650)');
      expect(output).toContain(BRANCH_DELETED_KEY);
      // Exactly one, and the right one: main's addition is not in the verdict.
      expect(output).not.toContain(MAIN_ADDED_KEY);
    },
  );

  it(
    'the baseline keys come from git at that commit, never from the anchor file (no self-verification)',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { forkBase, anchored, mainTip } = seedUpstream((s) => s);
      forkBranch('issue-6452-shed-anchor-key', anchored, mainTip);
      // The anchor sheds a line the commit it NAMES really carries — the #4650
      // attack moved one file over, and the shape the shortcut would bless.
      seedSurfaceBase(forkBase, (k) => k.filter((x) => x !== SHED_KEY));

      const { status, output } = run(['--check']);

      // THE pin. Resolve the baseline from the anchor file's own `keys` and this
      // comparison becomes file-against-file: it passes, the run exits 0, and the
      // shed line is gone from the baseline for good. Reading the keys out of git
      // at `baseRev` is the only thing that makes it red.
      expect(status).toBe(1);
      expect(output).toContain('is not the baseline it claims to be (#4650, #5235)');
      expect(output).toContain(`- ${SHED_KEY}  (at ${forkBase.slice(0, 12)}, absent here)`);
    },
  );

  it(
    'an anchor rev only this branch vouches for: the shallow run uses it, the walkable run refuses it',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      const { anchored, mainTip } = seedUpstream((s) => [...s, BRANCH_DELETED_KEY].sort());
      git('checkout', '-q', '-B', 'issue-6452-unvouched', anchored);
      // The branch deletes the key, commits it, and then points `baseRev` at its
      // OWN commit — authentic against itself (its keys ARE that commit's
      // surface), upstream against nothing.
      seedSurface((s) => s);
      git('add', AUTHORABLE_SURFACE_DIR_NAME);
      git('commit', '-q', '-m', 'fixture: the branch deletes a baseline key');
      const branchOwn = git('rev-parse', 'HEAD');
      seedSurfaceBase(branchOwn, (k) => k);
      git('add', 'authorable-surface.base.json');
      git('commit', '-q', '-m', 'fixture: the branch anchors on its own commit');

      // Truncated. Nothing here can refute the forged rev by walking, and the
      // run no longer overrides the tree's anchor with the one main records —
      // that override is what made a commit's verdict move with main (#24359).
      // The trade, stated rather than hidden: this run is green.
      fs.writeFileSync(shallowFile(), `${mainTip}\n`);
      expect(mergeBaseFails(mainTip)).toBe(true);
      const shallow = run(['--check']);
      expect(shallow.output).toContain(`anchors on ${branchOwn.slice(0, 12)} rather than on`);
      expect(shallow.output).toContain('That the rev is upstream is proved where');
      expect(shallow.output).not.toContain(BRANCH_DELETED_KEY);
      expect(shallow.status).toBe(0);

      // Walkable — the checkout this repository's own PR and merge-queue gate
      // asks for (`fetch-depth: 0`). The forged rev is refused there, before any
      // baseline is read: this is where the anchor's upstream half is proved.
      fs.rmSync(shallowFile(), { force: true });
      expect(git('rev-parse', '--is-shallow-repository')).toBe('false');
      const walkable = run(['--check']);
      expect(walkable.status).toBe(1);
      expect(walkable.output).toContain('NOT an ancestor of');
      expect(walkable.output).toContain(branchOwn.slice(0, 12));
    },
  );

  it(
    "origin/main carrying no anchor changes nothing: the tree's own anchor is the baseline",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Main's tree carries no anchor. Before #24359 that left this run with
      // nothing it would accept, so it anchored on main's TIP and reported
      // MAIN_ADDED_KEY as this branch's deletion. The tree's own anchor was there
      // all along, and it is the only one the verdict may depend on.
      seedManifest((s) => s);
      const forkBase = seedBase((s) => s);
      seedSurfaceBase(forkBase, (k) => k);
      git('add', 'authorable-surface.base.json');
      git('commit', '-q', '-m', 'fixture: anchor at the fork point');
      const anchored = git('rev-parse', 'HEAD');
      git('rm', '-q', 'authorable-surface.base.json');
      const mainTip = seedBase((s) => [...s, MAIN_ADDED_KEY].sort());
      forkBranch('issue-6452-no-upstream-anchor', anchored, mainTip);

      const { status, output } = run(['--check']);

      expect(output).toContain(`anchors on ${forkBase.slice(0, 12)} rather than on`);
      expect(output).not.toContain('anchors on the origin/main TIP');
      expect(output).not.toContain('deleted without proof');
      expect(output).not.toContain(MAIN_ADDED_KEY);
      expect(status).toBe(0);
    },
  );

  it(
    'a tree that carries no anchor of its own refuses — the tip is never its baseline',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedManifest((s) => s);
      const forkBase = seedBase((s) => s);
      const mainTip = seedBase((s) => [...s, MAIN_ADDED_KEY].sort());
      forkBranch('issue-6452-tree-without-anchor', forkBase, mainTip);
      // The tree under test does not carry the anchor; `afterEach`'s checkout of
      // main brings it back for the next case.
      fs.rmSync(surfaceBasePath);

      const { status, output } = run(['--check']);

      // Loud, and about what is MISSING — never the old accusation that this
      // tree deleted a key main added.
      expect(status).toBe(1);
      expect(output).toContain('No baseline to anchor the deletion checks on');
      expect(output).toContain('authorable-surface.base.json');
      expect(output).toContain('fetch-depth: 0');
      expect(output).not.toContain('anchors on the origin/main TIP');
      expect(output).not.toContain('deleted without proof');
      expect(output).not.toContain(MAIN_ADDED_KEY);
    },
  );

  it(
    'an anchor commit this checkout cannot read refuses — it never falls back to the tip',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // What a `--depth=1` clone sees when the fetch of the anchor commit fails:
      // the old run fell back to main's TIP and reported every schema main had
      // published since as this commit's removal.
      seedManifest((s) => s);
      const forkBase = seedBase((s) => s);
      const mainTip = seedBase((s) => [...s, MAIN_ADDED_KEY].sort());
      forkBranch('issue-6452-unreadable-anchor', forkBase, mainTip);
      // A rev no object store here holds and no remote serves — the fixture
      // repository has no remote at all, so the fetch fails as it does offline.
      const unreadable = 'f'.repeat(40);
      expect(gitStatusIn(sandbox, 'cat-file', '-e', `${unreadable}^{commit}`)).not.toBe(0);
      seedSurfaceBase(unreadable, (k) => k);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('is not in this checkout, and the remote did not');
      expect(output).toContain(`git fetch --depth=1 origin ${unreadable}`);
      expect(output).not.toContain('anchors on the origin/main TIP');
      expect(output).not.toContain('deleted without proof');
      expect(output).not.toContain(MAIN_ADDED_KEY);
    },
  );

  /**
   * Cases 6–7: a commit that is ALREADY on main — a release, say — rebuilt in a
   * truncated clone, once under a main that only moved on and once under a main
   * that then re-anchored past it. The manifest is tracked here (the rest of this
   * block leaves it untracked), because the manifest removal check is the gate
   * the reported rebuild failed on.
   */
  function seedReleasedCommit(anchorManifest: (s: string[]) => string[]): {
    forkBase: string;
    underTest: string;
    mainMovedOn: string;
    mainReanchored: string;
  } {
    const commitManifest = (mutate: (s: string[]) => string[]): void => {
      seedManifest(mutate);
      git('add', SCHEMA_MANIFEST_DIR_NAME);
    };
    // The commit's upstream base, and the commit itself: its anchor names that base.
    commitManifest(anchorManifest);
    const forkBase = seedBase((s) => s);
    commitManifest((s) => s);
    seedSurfaceBase(forkBase, (k) => k);
    git('add', 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: the commit under test, anchored at its base');
    const underTest = git('rev-parse', 'HEAD');
    // Main moves on: it publishes a schema and a key the commit never had…
    commitManifest((s) => [...s, MAIN_ADDED_DEF].sort());
    const mainMovedOn = seedBase((s) => [...s, MAIN_ADDED_KEY].sort());
    // …and then re-anchors on its own tip, the way `--update-base` does.
    seedSurfaceBase(mainMovedOn, (k) => [...k, MAIN_ADDED_KEY].sort());
    git('add', 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: main re-anchors past the commit under test');
    const mainReanchored = git('rev-parse', 'HEAD');
    return { forkBase, underTest, mainMovedOn, mainReanchored };
  }

  /** Build `underTest` in a clone truncated at `originMain`, which origin/main names. */
  function judgeUnder(underTest: string, originMain: string): { status: number; output: string } {
    git('update-ref', 'refs/remotes/origin/main', originMain);
    forkBranch(`issue-24359-under-${originMain.slice(0, 7)}`, underTest, originMain);
    try {
      return run(['--check']);
    } finally {
      fs.rmSync(shallowFile(), { force: true });
    }
  }

  /** Hand the block back with the manifest untracked again, as every other case expects. */
  function untrackManifest(): void {
    git('checkout', '-q', '-f', 'main');
    git('rm', '-r', '-q', '--cached', SCHEMA_MANIFEST_DIR_NAME);
    seedManifest((s) => s);
    git('commit', '-q', '-m', 'fixture: the manifest is untracked again');
  }

  it(
    'the verdict belongs to the commit: the same tree is judged alike under a main that re-anchored past it',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      const { forkBase, underTest, mainMovedOn, mainReanchored } = seedReleasedCommit((s) => s);
      try {
        const movedOn = judgeUnder(underTest, mainMovedOn);
        const reanchored = judgeUnder(underTest, mainReanchored);

        // Before #24359 the second run anchored on the rev main's anchor names
        // and exited 1: `1 schema(s) left the published set with no registered
        // removal`, naming MAIN_ADDED_DEF — a schema this commit never had.
        for (const { status, output } of [movedOn, reanchored]) {
          expect(output).toContain(`anchors on ${forkBase.slice(0, 12)} rather than on`);
          expect(output).not.toContain(NO_REGISTERED_REMOVAL);
          expect(output).not.toContain(MAIN_ADDED_DEF);
          expect(output).not.toContain(MAIN_ADDED_KEY);
          expect(output).not.toContain('deleted without proof');
          // …and green because the comparison RAN, not for want of a baseline.
          expect(output).not.toContain('removal check: no');
          expect(status).toBe(0);
        }
      } finally {
        untrackManifest();
      }
    },
  );

  it(
    "the shallow verdict keeps its teeth: a schema the commit's anchor recorded and the build dropped is red under either main",
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      // The #4725 bypass shape: published at the commit's anchor, gone from the
      // build AND from the commit's own manifest, registered nowhere.
      const { forkBase, underTest, mainMovedOn, mainReanchored } = seedReleasedCommit((s) =>
        [...s, ANCHOR_ONLY_DEF].sort(),
      );
      try {
        // Under the re-anchored main the old run compared against main's anchor,
        // which no longer lists ANCHOR_ONLY_DEF — so it MISSED this removal and
        // reported MAIN_ADDED_DEF instead.
        for (const originMain of [mainMovedOn, mainReanchored]) {
          const { status, output } = judgeUnder(underTest, originMain);
          expect(output).toContain(`anchors on ${forkBase.slice(0, 12)} rather than on`);
          expect(status).toBe(1);
          expect(output).toContain(`1 ${NO_REGISTERED_REMOVAL}`);
          expect(output).toContain(`     - json-schema/${ANCHOR_ONLY_DEF}.json`);
          expect(output).not.toContain(MAIN_ADDED_DEF);
        }
      } finally {
        untrackManifest();
      }
    },
  );
});
