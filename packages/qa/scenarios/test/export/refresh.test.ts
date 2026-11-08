// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The gallery refresh (`refresh.ts`, CLI `refresh-cli.ts`) on a fixture
 * gallery checkout: a real git repository with a bare `origin`, a stubbed npm
 * version reader, and a run step that runs the real crm card through
 * `runCard` with the fixture's scripted model inside the runner's own
 * `RecordingDriver` (`fixture.ts`), writing the record and the recording
 * where `run-scenarios` would. No network, no model, no browser.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GalleryGuard } from '../../src/export/generic.js';
import { parseIndex, serializeIndex, type GalleryApp } from '../../src/export/manifest.js';
import { main, parseRefreshArgs, renderOutcome } from '../../src/export/refresh-cli.js';
import { galleryBranch, galleryRefresh, RefreshRefusal, runnerArgv, STABLE_VERSION, type RefreshDeps, type RefreshOptions, type RunPlan } from '../../src/export/refresh.js';
import { parseArgs } from '../../src/runner/cli.js';
import { CARD_ID, loadAllCards, loadCrm, runCrm, tempDir, writeRecord } from './fixture.js';

/** The crm card is a `control` card the real guard refuses: this double lets it through, as the exporter's tests do. */
const ELIGIBLE_DOUBLE: GalleryGuard = () => ({ eligible: true, reasons: [] });

/** The version the fixture's scaffold pins (`@objectstack/spec` 18.3.0 in its package.json). */
const PINNED = '18.3.0';

function sh(dir: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A listed app, as the exporter writes it, at this framework version. */
function app(id: string, version: string): GalleryApp {
  return {
    id,
    code: 'crm',
    namespace: 'democrm',
    path: `apps/${id}`,
    function: 'sales',
    title: { en: 'CRM', zh: '客户' },
    summary: {},
    capabilities: [],
    screenshots: [],
    qa: { questions: 1, turns: 1, personas: 1 },
    operations: 0,
    framework: { version, runner: 'abc1234' },
    runDate: '2026-11-01',
    run: `2026-11-01-scenario-${id}`,
  };
}

/** A gallery checkout: `main` with a README (and an index when `apps` is given), pushed to a bare `origin`. */
function gallery(apps?: GalleryApp[]): { dir: string; remote: string } {
  const root = tempDir('refresh');
  const remote = join(root, 'origin.git');
  const dir = join(root, 'gallery');
  mkdirSync(dir);
  spawnSync('git', ['init', '--quiet', '--bare', '-b', 'main', remote]);
  sh(dir, 'init', '--quiet', '-b', 'main');
  sh(dir, 'config', 'user.name', 'Gallery Maintainer');
  sh(dir, 'config', 'user.email', 'maintainer@example.test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# gallery\n');
  if (apps) {
    writeFileSync(join(dir, 'index.json'), serializeIndex(apps));
    for (const a of apps) {
      mkdirSync(join(dir, a.path), { recursive: true });
      writeFileSync(join(dir, a.path, 'README.md'), `# ${a.id}\n`);
    }
  }
  sh(dir, 'add', '--all');
  sh(dir, 'commit', '--quiet', '-m', 'init');
  sh(dir, 'remote', 'add', 'origin', remote);
  sh(dir, 'push', '--quiet', 'origin', 'main');
  sh(dir, 'fetch', '--quiet', 'origin');
  return { dir, remote };
}

/** Every ref of the bare remote: a refresh must leave it as it was. */
const remoteRefs = (remote: string) => sh(remote, 'for-each-ref', '--format=%(refname) %(objectname)');

interface Harness {
  plans: RunPlan[];
  deps: RefreshDeps;
}

/** The deps a test refresh runs with: npm answers `latest`, the run is the fixture's crm run (scratch mode). */
function harness(latest: string | (() => string), over: { iterateRun?: boolean; also?: (plan: RunPlan) => void } = {}): Harness {
  const plans: RunPlan[] = [];
  return {
    plans,
    deps: {
      latestVersion: typeof latest === 'string' ? () => latest : latest,
      guard: ELIGIBLE_DOUBLE,
      screenshots: false,
      run: async (plan) => {
        plans.push(plan);
        const fx = await runCrm({ work: plan.workDir, modes: ['scratch'], ...(over.iterateRun === false ? { iterateRun: false } : {}) });
        writeRecord(plan.runsDir, fx.record);
        writeFileSync(plan.recording, JSON.stringify(fx.recording));
        over.also?.(plan);
      },
    },
  };
}

const options = (dir: string, over: Partial<RefreshOptions> = {}): RefreshOptions => ({ galleryDir: dir, cards: [loadCrm()], workDir: tempDir('work'), ...over });

async function refused(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(RefreshRefusal);
  return (e as Error).message;
}

describe('galleryRefresh — the quiet skip', () => {
  it('skips with one `skip:` line, running nothing, when every listed app states npm’s latest stable version', async () => {
    const { dir, remote } = gallery([app('crm_account_with_contacts', PINNED), app('order_to_cash', PINNED)]);
    const head = sh(dir, 'rev-parse', 'HEAD');
    const refs = remoteRefs(remote);
    const h = harness(PINNED);
    const out = await galleryRefresh(options(dir), h.deps);
    expect(out.kind).toBe('skip');
    expect(out.kind === 'skip' && out.line).toMatch(/^skip: .*18\.3\.0/);
    expect(h.plans).toEqual([]);
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(sh(dir, 'status', '--porcelain')).toBe('');
    expect(remoteRefs(remote)).toBe(refs);
  });

  it('does not skip when one listed app is on an older version, or when the index lists no app', async () => {
    for (const apps of [[app('crm_account_with_contacts', PINNED), app('order_to_cash', '18.2.0')], [], undefined]) {
      const { dir } = gallery(apps);
      const h = harness(PINNED);
      const out = await galleryRefresh(options(dir), h.deps);
      expect(out.kind).toBe('committed');
      expect(h.plans).toHaveLength(1);
    }
  });

  it('skips when a remote-tracking export/<version> branch exists: that refresh awaits review', async () => {
    const { dir, remote } = gallery();
    sh(dir, 'push', '--quiet', 'origin', `main:refs/heads/${galleryBranch(PINNED)}`);
    sh(dir, 'fetch', '--quiet', 'origin');
    const refs = remoteRefs(remote);
    const h = harness(PINNED);
    const out = await galleryRefresh(options(dir), h.deps);
    expect(out).toEqual({ kind: 'skip', line: `skip: origin/export/${PINNED} already exists: the refresh for ${PINNED} awaits review` });
    expect(h.plans).toEqual([]);
    expect(remoteRefs(remote)).toBe(refs);
  });
});

describe('galleryRefresh — run, export, commit on export/<version>', () => {
  it('commits apps/ and index.json on export/<version> under the checkout’s identity, never pushes, and returns the PR body', async () => {
    const { dir, remote } = gallery();
    const base = sh(dir, 'rev-parse', 'HEAD');
    const refs = remoteRefs(remote);
    const h = harness(PINNED);
    const out = await galleryRefresh(options(dir, { model: 'sonnet' }), h.deps);
    if (out.kind !== 'committed') throw new Error('expected a commit');

    expect(out.branch).toBe('export/18.3.0');
    expect(sh(dir, 'branch', '--show-current')).toBe('export/18.3.0');
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(out.commit);
    expect(sh(dir, 'rev-parse', 'HEAD^')).toBe(base);
    expect(sh(dir, 'status', '--porcelain')).toBe('');
    expect(sh(dir, 'log', '-1', '--format=%an <%ae>')).toBe('Gallery Maintainer <maintainer@example.test>');
    const files = sh(dir, 'diff', '--name-only', 'HEAD^', 'HEAD').split('\n');
    expect(files).toContain('index.json');
    expect(files.every((f) => f === 'index.json' || f.startsWith(`apps/${CARD_ID}/`))).toBe(true);
    expect(parseIndex(readFileSync(join(dir, 'index.json'), 'utf8')).apps.map((a) => [a.id, a.framework.version])).toEqual([[CARD_ID, PINNED]]);
    // ⛔ never pushes: the remote holds exactly what it held.
    expect(remoteRefs(remote)).toBe(refs);

    expect(h.plans).toHaveLength(1);
    expect(h.plans[0]).toMatchObject({ version: PINNED, cards: [CARD_ID], model: 'sonnet' });
    expect(out.body).toContain('`export/18.3.0`');
    expect(out.body).toContain(`\`${CARD_ID}\``);
    expect(out.body).toContain('`sonnet`');
    expect(out.body).toContain('none (the gallery listed no app)');

    // The next day: the index now states the release, so the refresh skips.
    const again = harness(PINNED);
    expect((await galleryRefresh(options(dir), again.deps)).kind).toBe('skip');
    expect(again.plans).toEqual([]);
  });

  it('asks run-scenarios for exactly that release, published packages, scratch mode, the cards and the model', () => {
    const plan: RunPlan = { version: PINNED, cards: ['leave_balances', 'service_desk'], cardsDir: '/c', runsDir: '/w/runs', workDir: '/w/work', recording: '/w/rec.json', model: 'haiku' };
    const args = parseArgs(runnerArgv(plan));
    expect(args).toMatchObject({
      cards: '/c',
      only: ['leave_balances', 'service_desk'],
      modes: ['scratch'],
      packages: 'published',
      createVersion: PINNED,
      out: '/w/runs',
      work: '/w/work',
      record: '/w/rec.json',
      model: 'haiku',
      driver: 'claude',
      iterateRun: true,
    });
    const { model: _model, cardsDir: _cards, ...bare } = plan;
    expect(parseArgs(runnerArgv(bare))).not.toHaveProperty('model');
  });

  it('runs every card the real gallery guard admits, and with --debut only the first of them by id', async () => {
    const cards = loadAllCards();
    const plansOf = async (debut: boolean) => {
      const { dir } = gallery();
      const plans: RunPlan[] = [];
      // The run writes nothing, so the refresh stops after it: only the plan is read here.
      const msg = await refused(galleryRefresh(options(dir, { cards, debut }), { latestVersion: () => PINNED, screenshots: false, run: async (p) => void plans.push(p) }));
      expect(msg).toMatch(/wrote no record/);
      return plans[0]!.cards;
    };
    const starters = cards.filter((s) => s.card.tier !== 'control').map((s) => s.card.id).sort();
    expect(starters.length).toBeGreaterThan(1);
    expect(await plansOf(false)).toEqual(starters);
    expect(await plansOf(true)).toEqual([starters[0]]);
  });
});

describe('galleryRefresh — refusals (exit non-zero, nothing committed)', () => {
  it('refuses a latest that is not a stable MAJOR.MINOR.PATCH, and an npm read that fails, before running anything', async () => {
    for (const v of ['18.4.0-rc.1', '18.4', '', 'v18.4.0']) {
      expect(STABLE_VERSION.test(v)).toBe(false);
      const h = harness(v);
      expect(await refused(galleryRefresh(options(gallery().dir), h.deps))).toMatch(/not a stable/);
      expect(h.plans).toEqual([]);
    }
    const h = harness(() => {
      throw new Error('npm ERR! code E404');
    });
    expect(await refused(galleryRefresh(options(gallery().dir), h.deps))).toMatch(/could not be read: npm ERR! code E404/);
    expect(h.plans).toEqual([]);
  });

  it('refuses a directory that is not the top of a clean git checkout, or whose index.json does not validate', async () => {
    const h = harness(PINNED);
    expect(await refused(galleryRefresh(options(tempDir('plain')), h.deps))).toMatch(/not the top of a git checkout/);
    const sub = join(gallery().dir, 'apps');
    mkdirSync(sub);
    expect(await refused(galleryRefresh(options(sub), h.deps))).toMatch(/not the top of a git checkout/);
    const dirty = gallery().dir;
    writeFileSync(join(dirty, 'notes.txt'), 'hand edit\n');
    expect(await refused(galleryRefresh(options(dirty), h.deps))).toMatch(/uncommitted changes \(notes\.txt\)/);
    const broken = gallery().dir;
    writeFileSync(join(broken, 'index.json'), '{"apps": []}\n');
    sh(broken, 'add', 'index.json');
    sh(broken, 'commit', '--quiet', '-m', 'broken index');
    expect(await refused(galleryRefresh(options(broken), h.deps))).toMatch(/not a gallery index the exporter wrote/);
    expect(h.plans).toEqual([]);
  });

  it('refuses a local export/<version> branch: an earlier refresh’s commit is never overwritten', async () => {
    const { dir } = gallery();
    sh(dir, 'branch', galleryBranch(PINNED));
    const h = harness(PINNED);
    expect(await refused(galleryRefresh(options(dir), h.deps))).toMatch(/already has a local branch export\/18\.3\.0/);
    expect(h.plans).toEqual([]);
  });

  it('refuses --debut into a gallery that already lists an app', async () => {
    const { dir } = gallery([app('order_to_cash', '18.2.0')]);
    const h = harness(PINNED);
    expect(await refused(galleryRefresh(options(dir, { debut: true }), h.deps))).toMatch(/--debut .* already lists 1/);
    expect(h.plans).toEqual([]);
  });

  it('refuses to commit an app that states another framework version than the release it was asked for', async () => {
    const { dir } = gallery();
    const base = sh(dir, 'rev-parse', 'HEAD');
    const msg = await refused(galleryRefresh(options(dir), harness('18.4.0').deps));
    expect(msg).toContain(`${CARD_ID} states framework ${PINNED}, not 18.4.0`);
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(base);
    expect(sh(dir, 'branch', '--list', 'export/*')).toBe('');
  });

  it('refuses when no app exported (a run that did not pass every half), naming why', async () => {
    const { dir } = gallery();
    const base = sh(dir, 'rev-parse', 'HEAD');
    const msg = await refused(galleryRefresh(options(dir), harness(PINNED, { iterateRun: false }).deps));
    expect(msg).toMatch(new RegExp(`no app exported for 18\\.3\\.0.*${CARD_ID}: .*did not pass every half`));
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(base);
    expect(sh(dir, 'branch', '--list', 'export/*')).toBe('');
  });

  it('refuses when anything outside apps/ and index.json changed in the checkout', async () => {
    const { dir } = gallery();
    const msg = await refused(galleryRefresh(options(dir), harness(PINNED, { also: () => writeFileSync(join(dir, '.env'), 'X=1\n') }).deps));
    expect(msg).toMatch(/changed outside apps\/ and index\.json \(\.env\)/);
    expect(sh(dir, 'branch', '--list', 'export/*')).toBe('');
  });
});

describe('gallery-refresh CLI', () => {
  it('parses its flags, and refuses a missing --gallery, a bad --model and an unknown flag', () => {
    expect(parseRefreshArgs(['--gallery', 'g', '--cards', 'c', '--model', 'opus', '--debut', '--work', 'w', '--chromium', 'x'])).toEqual({ gallery: 'g', cards: 'c', model: 'opus', debut: true, work: 'w', chromium: 'x' });
    expect(parseRefreshArgs(['--gallery', 'g'])).toEqual({ gallery: 'g', debut: false });
    expect(() => parseRefreshArgs([])).toThrow(/--gallery DIR is required/);
    for (const bad of ['', ' ', '--debut']) expect(() => parseRefreshArgs(['--gallery', 'g', '--model', bad])).toThrow(/--model takes a model alias/);
    expect(() => parseRefreshArgs(['--gallery', 'g', '--push'])).toThrow(/unknown flag `--push`/);
  });

  it('prints exactly one `skip:` line and exits 0 when the gallery is on the release', async () => {
    const { dir } = gallery([app(CARD_ID, PINNED)]);
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['--gallery', dir], { latestVersion: () => PINNED, screenshots: false }, { out: (l) => out.push(l), err: (l) => err.push(l) });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^skip: /);
    expect(err).toEqual([]);
  });

  it('on the repo’s own cards: runs, exports, commits, and prints the branch and the PR body; a refusal exits 1 with why', async () => {
    const { dir, remote } = gallery();
    const refs = remoteRefs(remote);
    const h = harness(PINNED);
    const out: string[] = [];
    const io = { out: (l: string) => out.push(l), err: () => {} };
    expect(await main(['--gallery', dir], h.deps, io)).toBe(0);
    expect(h.plans[0]!.cards).toEqual(loadAllCards().map((s) => s.card.id).sort());
    expect(out).toContain('branch: export/18.3.0');
    expect(out.some((l) => l.startsWith('Gallery refresh for ObjectStack 18.3.0'))).toBe(true);
    expect(remoteRefs(remote)).toBe(refs);

    const err: string[] = [];
    expect(await main(['--gallery', gallery().dir], harness('18.4.0-rc.1').deps, { out: () => {}, err: (l) => err.push(l) })).toBe(1);
    expect(err[0]).toMatch(/^gallery-refresh: refused — npm's latest @objectstack\/cli is `18\.4\.0-rc\.1`/);
  });

  it('renders a skip as its one line', () => {
    expect(renderOutcome({ kind: 'skip', line: 'skip: x' })).toEqual(['skip: x']);
  });
});
