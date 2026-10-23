// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 190 — spawns the real producer once per single-cause fixture: every case runs the real schema generator (build-schemas.ts --check) in its own sandbox git tree, one fixture per cause; apportioned 2026-10-23 when #25372 split build-schemas-check-mode.test.ts: the pre-split file's slowest CI reading (983.3 s, run 38798542648) x this file's share of one local whole-file run (125.6 of 828.2 s), x 1.25, rounded up; re-measure once CI has read this file on its own
//
// The in-tree anchor: it carries the deletion gate offline (#5235), and only
// --update-base moves it (#5358).
//
// One of the `build-schemas-check-mode.*.test.ts` files (#25372 split the one
// file so the repo project's workers run its blocks in parallel). The family's
// header — what `--check` pins and why every case runs in a sandbox git tree —
// and the shared sandbox, helpers and constants live in
// `build-schemas-check-mode.fixture.ts`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DELETED_LIVE,
  git,
  pristineSurface,
  readSurfaceBase,
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
// #5235 — the same gate, in a build that cannot reach GitHub.
//
// The #4650 anchor is `authorable-surface.json` at the merge base with
// origin/main, resolved out of git. Consumers that build a SHA-pinned framework
// tree inside an environment with no route to GitHub — cloud's buildx image
// stages, air-gapped builds, forks, historical-tag reproductions — cannot
// resolve it, and the gate failed the whole build there. Deleting
// `refs/remotes/origin/main` in the sandbox models exactly that (the sandbox has
// no `origin` remote either, so the self-heal fetch cannot rescue it).
//
// The fix is an in-tree anchor, and these tests pin the three properties that
// make it a fix rather than a bypass:
//
//   * offline, the gate RUNS against the committed anchor and still fails on an
//     unproven deletion (it is not "skip when git is unavailable");
//   * offline, nothing may WRITE the anchor — an offline build that could
//     advance it to its own state would be laundering the baseline;
//   * where origin/main IS reachable, the anchor is verified against it, so a
//     commit cannot edit the anchor to hide a deletion.
describe('build-schemas.ts — an in-tree anchor carries the deletion gate offline (#5235)', () => {
  /** Recorded in the anchor, emitted by no build: the offline gate's input. */
  const ONLY_AT_BASE = 'data/Object:zzOnlyInTreeAnchor5235';
  /** A real, reachable, live key — shedding it from the anchor is the attack. */
  const SHED_FROM_ANCHOR = 'data/Object:label';

  let head: string;

  beforeEach(() => {
    // A clean, current tree: manifest and worktree baseline canonical, and
    // origin/main holding that same baseline.
    seedManifest((s) => s);
    head = seedBase((s) => s);
    seedSurface((s) => s);
    seedSurfaceBase(head, (k) => k);
  });

  afterEach(() => {
    git('update-ref', 'refs/remotes/origin/main', head);
  });

  /** Run with no resolvable origin/main — the consumer/offline build shape. */
  function offline<T>(fn: () => T): T {
    git('update-ref', '-d', 'refs/remotes/origin/main');
    try {
      return fn();
    } finally {
      git('update-ref', 'refs/remotes/origin/main', head);
    }
  }

  it(
    'builds instead of failing when origin/main is unreachable, anchoring on the committed baseline',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = offline(() => run(['--check']));

      expect(status).toBe(0);
      // The #5235 fatal is gone…
      expect(output).not.toContain('Cannot resolve origin/main');
      expect(output).not.toContain('No baseline to anchor');
      // …and the run says which anchor it used, naming the commit it mirrors.
      expect(output).toContain('origin/main is not resolvable in this build environment');
      expect(output).toContain('authorable-surface.base.json');
      expect(output).toContain(head.slice(0, 12));
    },
  );

  it(
    'still fails offline on a deletion the anchor records and this build cannot account for',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Set-wise identical to the real attack: a line present at the base and
      // absent from the build's emitted surface. Check (a) reads the WORKTREE
      // baseline, which stays canonical, so only the anchored check (c) can see
      // this — which is the whole point of anchoring offline at all.
      seedSurfaceBase(head, (k) => [...k, ONLY_AT_BASE].sort());

      const { status, output } = offline(() => run(['--check']));

      expect(status).toBe(1);
      expect(output).toContain('deleted without proof (#4650)');
      expect(output).toContain(ONLY_AT_BASE);
      expect(output).toMatch(/LIVE \(never tombstoned\)/);
    },
  );

  it(
    'never advances the anchor from an offline build — not on success, not on failure',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      // A LAGGING anchor: one key short of the current surface. A writer fed by
      // this build (rather than by a git-resolved baseline) would "helpfully"
      // top it up, and the next offline build would then be checking the tree
      // against itself. Write mode must leave it byte-identical.
      const lagging = seedSurfaceBase(head, (k) => k.filter((x) => x !== SHED_FROM_ANCHOR));

      const clean = offline(() => run([]));
      expect(clean.status).toBe(0);
      expect(readSurfaceBase()).toBe(lagging);

      // Same on the failing path: the anchor recording a key this build cannot
      // account for must not be rewritten into agreement with it.
      const planted = seedSurfaceBase(head, (k) => [...k, ONLY_AT_BASE].sort());
      const red = offline(() => run([]));
      expect(red.status).toBe(1);
      expect(red.output).toContain('deleted without proof (#4650)');
      expect(readSurfaceBase()).toBe(planted);
    },
  );

  it(
    'catches the anchor being edited to hide a deletion, wherever origin/main IS reachable',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(
        pristineSurface,
        `${SHED_FROM_ANCHOR} is no longer in the baseline — pick another live key`,
      ).toContain(SHED_FROM_ANCHOR);
      // The bypass this file exists to prevent, moved one file over: drop the
      // line from the anchor so an offline build would never miss it.
      seedSurfaceBase(head, (k) => k.filter((x) => x !== SHED_FROM_ANCHOR));

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('is not the baseline it claims to be');
      expect(output).toContain(SHED_FROM_ANCHOR);
      // The remedy names the one command that may write this file — `gen:schema`
      // stopped being it at #5358, and a prescription pointing at a command that
      // no longer touches the file is the defect that issue is about.
      expect(output).toContain('gen:authorable-surface-base');
    },
  );

  it(
    'refuses an anchor pinned to a commit off origin/main — a rev the commit under test controls',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The other half of the same forgery: keep the keys honest, but point
      // baseRev at a LOCAL commit. Its baseline would match, so only the
      // ancestry test can tell it apart from an upstream one.
      git('commit', '-q', '--allow-empty', '-m', 'a commit this branch controls');
      const local = git('rev-parse', 'HEAD');
      expect(local).not.toBe(head);
      seedSurfaceBase(local, (k) => k);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('NOT an ancestor of');
      expect(output).toContain(local.slice(0, 12));
    },
  );

  it(
    'does not mistake a shallow checkout for a forged baseRev — CI is shallow, and ancestry there is unwalkable',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The shape that broke this change's own first CI run. CI checks out
      // depth 1, the anchor's commit is fetched as its own shallow root, and
      // `merge-base --is-ancestor` then answers "not an ancestor" about a commit
      // that plainly is one. Trusting that answer fails every build.
      //
      // `$GIT_DIR/shallow` is what makes a repository shallow, so writing the
      // current tip into it truncates history exactly the way `--depth=1` does —
      // no clone, and `git show BASEREV:file` still works, which is what keeps
      // the KEYS half of the verification alive here.
      const older = head;
      const tip = seedBase((s) => s);
      seedSurface((s) => s);
      seedSurfaceBase(older, (k) => k);
      fs.writeFileSync(path.join(sandbox, '.git', 'shallow'), `${tip}\n`);
      try {
        expect(git('rev-parse', '--is-shallow-repository')).toBe('true');
        const { status, output } = run(['--check']);

        expect(output).toContain('shallow checkout');
        expect(output).not.toContain('NOT an ancestor of');
        expect(status).toBe(0);
      } finally {
        fs.rmSync(path.join(sandbox, '.git', 'shallow'), { force: true });
      }
    },
  );

  it(
    'still compares the anchor keys in a shallow checkout — the half that survives truncation',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const older = head;
      const tip = seedBase((s) => s);
      seedSurface((s) => s);
      seedSurfaceBase(older, (k) => k.filter((x) => x !== SHED_FROM_ANCHOR));
      fs.writeFileSync(path.join(sandbox, '.git', 'shallow'), `${tip}\n`);
      try {
        const { status, output } = run(['--check']);

        expect(status).toBe(1);
        expect(output).toContain('is not the baseline it claims to be');
        expect(output).toContain(SHED_FROM_ANCHOR);
      } finally {
        fs.rmSync(path.join(sandbox, '.git', 'shallow'), { force: true });
      }
    },
  );

  it(
    'is a committed artifact: --check reports it missing without writing it, and only --update-base creates it',
    { timeout: SPAWN_TIMEOUT_MS * 3 },
    () => {
      fs.rmSync(surfaceBasePath);

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.output).toContain('authorable-surface.base.json is missing');
      // A check reports; it does not repair (#4711).
      expect(fs.existsSync(surfaceBasePath)).toBe(false);

      // A plain build says so loudly and still does not create it (#5358) — the
      // gate above is where a missing committed artifact goes red, not here.
      const build = run([]);
      expect(build.status).toBe(0);
      expect(build.output).toContain('a build no longer creates it (#5358)');
      expect(build.output).toContain('gen:authorable-surface-base');
      expect(fs.existsSync(surfaceBasePath)).toBe(false);

      const write = run(['--update-base']);
      expect(write.status).toBe(0);
      expect(write.output).toContain('authorable-surface.base.json created at');
      const doc = JSON.parse(readSurfaceBase()) as { baseRev: string; keys: string[] };
      // Written from the git-resolved baseline — the merge base, not this tree.
      expect(doc.baseRev).toBe(head);
      expect(doc.keys).toEqual(pristineSurface);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5358 — the anchor moves only when a human asks for it.
//
// #5235 gave the anchor two properties: it may only be written from a
// git-resolved baseline, and it is verified against origin/main wherever that is
// reachable. Both are about WHAT gets written. Neither says WHEN — and the answer
// was "on every run that regenerates", which meant every `pnpm build`, every
// `pnpm --filter '<pkg>^...' build` whose closure contains @objectstack/spec, and
// every `check:docs` (whose first step is `gen:schema`).
//
// Three developers reported the consequence independently, from three unrelated
// tasks (#4990, #5155, #5660): a file they had never opened showed up modified in
// `git status`, with `baseRev` advanced to the tip they branched from. Twice the
// same run also dropped 110 keys — the `ui/ComponentAnimation` family #4988/#5321
// had just retired. An anchor advanced past a retirement is an anchor that can no
// longer SEE that retirement, and the #4650 deletion gate is green before and
// after, because both states are internally consistent. The only thing standing
// between that and a merged PR was three people reading `git diff` line by line.
//
// The fix is a mode, not a smarter heuristic: `--update-base` writes the anchor,
// and nothing else does. What these tests pin is the negative — that a run which
// is NOT that mode leaves the working tree exactly as it found it — because that
// is the property `git add -A` can silently violate.
describe('build-schemas.ts — only --update-base moves the in-tree anchor (#5358)', () => {
  /** A live key held back from the older commit, so the anchor legitimately lags. */
  const LAGGING_KEY = 'data/Object:label';

  let older: string;
  let tip: string;
  let laggingAnchor: string;

  beforeEach(() => {
    // The real-world shape, built honestly: an OLDER upstream commit whose
    // baseline is one key short, then the current origin/main tip carrying the
    // full baseline. The anchor mirrors the older commit — authentic (its keys ARE
    // that commit's baseline) and legitimately behind the merge base, which is
    // exactly the state every checkout is in right after a surface change lands.
    seedManifest((s) => s);
    older = seedBase((s) => s.filter((k) => k !== LAGGING_KEY));
    tip = seedBase((s) => s);
    seedSurface((s) => s);
    laggingAnchor = seedSurfaceBase(older, (k) => k.filter((x) => x !== LAGGING_KEY));
    // Commit the fixture so the tree is CLEAN — `git diff --exit-code` is the
    // acceptance criterion, and it can only mean something from a clean start.
    // Only the two tracked artifacts: `git add -A` here would track the ~1600-file
    // json-schema/ output, which every subsequent run rewrites, and the cleanliness
    // assertions below would then measure the generator's own scratch space.
    git('add', 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: lagging but authentic anchor');
    git('update-ref', 'refs/remotes/origin/main', tip);
    expect(git('status', '--porcelain', '-uno')).toBe('');
  });

  afterEach(() => {
    git('update-ref', 'refs/remotes/origin/main', tip);
  });

  it(
    'a plain build leaves the anchor byte-identical and the working tree clean',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // THE regression test. Before #5358 this run rewrote the anchor to
      // {baseRev: tip, keys: full} and exited 0, so `git status` showed a file the
      // build's author never touched. `gen:schema` is `pnpm build`'s first step,
      // which is why an unrelated PR was one `git add -A` away from carrying it.
      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      // Silent is not enough: the run says the anchor lags, that this is not an
      // error, and what the deliberate act would be.
      expect(output).toContain('trails the baseline at');
      expect(output).toContain('not an error');
      expect(output).toContain('gen:authorable-surface-base');
      expect(output).not.toContain('⚓');
    },
  );

  it(
    'a --check run leaves the anchor byte-identical and the working tree clean',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The literal acceptance criterion of #5358: run the gate on a clean tree,
      // then `git diff --exit-code`. Unlike the case above this one already held
      // on `main` — the anchor's write branch was `!CHECK` before this change too
      // — so it is a pin, not a repair. It is here because "a check is read-only"
      // is the property the whole file exists for (#4711), and the entry point
      // that violated it was the neighbouring one.
      const { status } = run(['--check']);

      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(git('status', '--porcelain', '-uno')).toBe('');
    },
  );

  it(
    '--update-base re-anchors to the git-resolved baseline, and says so',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = run(['--update-base']);

      expect(status).toBe(0);
      expect(output).toContain('⚓');
      expect(output).toContain(tip.slice(0, 12));
      const doc = JSON.parse(readSurfaceBase()) as { baseRev: string; keys: string[] };
      // From the merge base, never from this build's own emitted surface (#5235).
      expect(doc.baseRev).toBe(tip);
      expect(doc.keys).toEqual(pristineSurface);
      expect(doc.keys).toContain(LAGGING_KEY);
      // Restore the fixture for the sibling cases — beforeEach re-commits anyway,
      // but a dirty tree between tests would make a failure here read as a failure
      // there.
      fs.writeFileSync(surfaceBasePath, laggingAnchor);
    },
  );

  it(
    '--update-base on an already-current anchor writes nothing and says nothing to do',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const current = seedSurfaceBase(tip, (k) => k);
      git('add', 'authorable-surface.base.json');
      git('commit', '-q', '-m', 'fixture: anchor already at the merge base');

      const { status, output } = run(['--update-base']);

      expect(status).toBe(0);
      expect(output).toContain('nothing to re-anchor');
      expect(readSurfaceBase()).toBe(current);
      expect(git('status', '--porcelain', '-uno')).toBe('');
    },
  );

  it(
    'refuses --check --update-base: a check that repairs what it detects can never report it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = run(['--check', '--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('mutually exclusive');
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      // Refused before the 1600-schema generation, not after it.
      expect(output).not.toContain('Generating JSON Schemas');
    },
  );

  it(
    'never writes the anchor from the build being checked — --update-base is powerless offline',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // #5235's rule survives the new mode: with origin/main unreachable there is
      // no git-resolved baseline, so there is nothing the flag may write FROM. A
      // `--update-base` that fell back to this build's own surface would be the
      // tree anchoring itself — the #4650 defect with a flag in front of it.
      git('update-ref', '-d', 'refs/remotes/origin/main');
      try {
        const { status, output } = run(['--update-base']);

        expect(status).toBe(0);
        expect(output).toContain('origin/main is not resolvable');
        expect(readSurfaceBase()).toBe(laggingAnchor);
        expect(git('status', '--porcelain', '-uno')).toBe('');
      } finally {
        git('update-ref', 'refs/remotes/origin/main', tip);
      }
    },
  );

  it(
    'still refuses to bless an unproven deletion in --update-base mode, and leaves the anchor alone',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Order is load-bearing (see the anchor block in build-schemas.ts): the
      // deletion gate adjudicates first, so the re-anchoring mode cannot be used to
      // walk the baseline past a deletion nothing proved. Without this, #5358's
      // explicit command would be a laundering route the old side effect never was.
      // The sabotage goes in the merge base — the anchor's own keys stay honest, so
      // only the gate, not the authenticity check, can be what fires.
      seedBase((s) => [...s, DELETED_LIVE].sort());
      seedSurface((s) => s);

      const { status, output } = run(['--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('deleted without proof (#4650)');
      expect(output).toContain(DELETED_LIVE);
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(output).not.toContain('⚓');
    },
  );
});
