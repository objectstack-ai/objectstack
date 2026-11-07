// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios run-scenarios [flags]` — run every card
 * under `docs/qa/scenarios/` end to end and write one run record per card.
 *
 *   --cards DIR          the card directory (default: the repo's docs/qa/scenarios);
 *                        any other directory is loaded as the private overlay,
 *                        where a `generic` card is refused (`libraryOf`)
 *   --only ID[,ID]       run only these cards
 *   --modes M[,M]        scratch, template (default: both)
 *   --driver claude      the local Claude Code CLI on your own login (default)
 *   --driver recorded:F  replay the recording F (no model, no network to a model)
 *   --record F           also save every live turn to F, for later replay
 *   --author-timeout MIN the live driver's budget per authoring turn, build and
 *                        iterate alike (default 60); a turn it kills leaves its
 *                        Build half not measured
 *   --author-max-turns N the live driver's turn cap per authoring turn, build
 *                        and iterate alike, on every card (default by the card's
 *                        tier: control 80, starter 300, delivery 600); a turn
 *                        that reaches it (`error_max_turns`) leaves its Build
 *                        half not measured
 *   --ask-max-turns N    the live driver's turn cap per question or operation
 *                        turn (default 12)
 *   --model M            the model every live turn asks for, an alias (`sonnet`)
 *                        or a name (`claude-sonnet-4-5`), as `claude --model`
 *                        takes it (default: the login's own)
 *   --author-model M     the model for authoring turns, build and iterate, in
 *                        place of --model
 *   --ask-model M        the model for question and operation turns, in place
 *                        of --model; the record and the scorecard state the
 *                        model each turn was served, and mark a mismatch
 *   --template F         a verified build (dist/objectstack.json) for template mode
 *   --no-iterate-run     skip the Run half after the iterate (scratch mode)
 *   --out DIR            where records go (default docs/qa/platform-checklist/runs, git-ignored)
 *   --work DIR           where projects are scaffolded (default: a temp dir)
 *   --create-version V   the create-objectstack version (default latest)
 *   --packages P         where the @objectstack/* packages come from (`packages.ts`):
 *                        `published` (default) — npm, what a customer gets;
 *                        `workspace` — this checkout, built and packed as the
 *                        release would publish it (unreleased; never exported)
 *
 * ⛔ No API-billed model: the live driver refuses to start when an API key is
 * configured (the cost ruling on cloud#3600).
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatRefusal, libraryOf, loadScenarios, readCapabilityAreas } from '../loader.js';
import { HttpApp } from './app.js';
import { ClaudeCodeDriver, RecordedDriver, RecordingDriver, type AgentDriver } from './driver.js';
import { minutesText, runCard, type ProjectOps } from './orchestrate.js';
import { installedSpecVersion, PACKAGES_MODES, prepareWorkspacePackages, settleWorkspaceProject, workspaceScaffolder, type PackageSource, type PackagesMode } from './packages.js';
import { bootDev, os, readArtifact, readNamespace, scaffold } from './project.js';
import { cardScorecard, renderScorecard, runRecord } from './scorecard.js';

/** The dev admin `objectstack dev --fresh` seeds; the runner and the gallery exporter sign in as it. */
export const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

export function findUp(start: string, test: (dir: string) => boolean): string {
  let dir = start;
  for (;;) {
    if (test(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`not found above ${start}`);
    dir = up;
  }
}

export interface CliArgs {
  cards?: string;
  only?: string[];
  modes: Array<'scratch' | 'template'>;
  driver: string;
  record?: string;
  template?: string;
  iterateRun: boolean;
  /** Minutes per authoring turn (`--author-timeout`); the driver's default when absent. */
  authorTimeoutMin?: number;
  /** Turns per authoring turn on every card (`--author-max-turns`); the card tier's default when absent. */
  authorMaxTurns?: number;
  /** Turns per question or operation turn (`--ask-max-turns`); the driver's default when absent. */
  askMaxTurns?: number;
  /** The model every live turn asks for (`--model`); the login's default when absent. */
  model?: string;
  /** The model an authoring turn asks for (`--author-model`), in place of `model`. */
  authorModel?: string;
  /** The model a question or operation turn asks for (`--ask-model`), in place of `model`. */
  askModel?: string;
  out?: string;
  work?: string;
  createVersion?: string;
  /** `--packages`: where the `@objectstack/*` packages come from. */
  packages: PackagesMode;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const a: CliArgs = { modes: ['scratch', 'template'], driver: 'claude', iterateRun: true, packages: 'published' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    const turns = () => {
      const raw = val();
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} takes a whole number of turns above 0, not \`${raw}\``);
      return n;
    };
    const model = () => {
      const raw = val();
      if (raw.trim() === '' || raw.startsWith('-')) throw new Error(`${flag} takes a model alias or name (sonnet, opus, claude-sonnet-4-5), not \`${raw}\``);
      return raw;
    };
    if (flag === '--cards') a.cards = val();
    else if (flag === '--only') a.only = val().split(',');
    else if (flag === '--modes') {
      const modes = val().split(',');
      for (const m of modes) if (m !== 'scratch' && m !== 'template') throw new Error(`unknown mode \`${m}\` (scratch, template)`);
      a.modes = modes as CliArgs['modes'];
    } else if (flag === '--driver') a.driver = val();
    else if (flag === '--record') a.record = val();
    else if (flag === '--template') a.template = val();
    else if (flag === '--no-iterate-run') a.iterateRun = false;
    else if (flag === '--author-timeout') {
      const raw = val();
      const min = Number(raw);
      if (!Number.isFinite(min) || min <= 0) throw new Error(`--author-timeout takes a number of minutes above 0, not \`${raw}\``);
      a.authorTimeoutMin = min;
    }
    else if (flag === '--author-max-turns') a.authorMaxTurns = turns();
    else if (flag === '--ask-max-turns') a.askMaxTurns = turns();
    else if (flag === '--model') a.model = model();
    else if (flag === '--author-model') a.authorModel = model();
    else if (flag === '--ask-model') a.askModel = model();
    else if (flag === '--out') a.out = val();
    else if (flag === '--work') a.work = val();
    else if (flag === '--create-version') a.createVersion = val();
    else if (flag === '--packages') {
      const p = val();
      if (!(PACKAGES_MODES as readonly string[]).includes(p)) throw new Error(`unknown --packages \`${p}\` (${PACKAGES_MODES.join(', ')})`);
      a.packages = p as PackagesMode;
    } else throw new Error(`unknown flag \`${flag}\``);
  }
  if (a.packages === 'workspace' && a.createVersion !== undefined) {
    throw new Error('--create-version names a published create-objectstack; --packages workspace scaffolds with the one this checkout builds');
  }
  return a;
}

/** The live driver's limits a run may set: `--author-timeout`, `--author-max-turns`, `--ask-max-turns`. */
export type DriverLimits = Pick<CliArgs, 'authorTimeoutMin' | 'authorMaxTurns' | 'askMaxTurns'>;

/** The models a run may ask the live driver for: `--model`, `--author-model`, `--ask-model`. */
export type DriverModels = Pick<CliArgs, 'model' | 'authorModel' | 'askModel'>;

const LIVE_FLAGS: ReadonlyArray<readonly [keyof (DriverLimits & DriverModels), string]> = [
  ['authorTimeoutMin', '--author-timeout'],
  ['authorMaxTurns', '--author-max-turns'],
  ['askMaxTurns', '--ask-max-turns'],
  ['model', '--model'],
  ['authorModel', '--author-model'],
  ['askModel', '--ask-model'],
];

export function makeDriver(spec: string, opts: DriverLimits & DriverModels = {}): AgentDriver {
  if (spec === 'claude') {
    return new ClaudeCodeDriver({
      ...(opts.authorTimeoutMin !== undefined ? { authorTimeoutMs: opts.authorTimeoutMin * 60_000 } : {}),
      ...(opts.authorMaxTurns !== undefined ? { authorMaxTurns: opts.authorMaxTurns } : {}),
      ...(opts.askMaxTurns !== undefined ? { askMaxTurns: opts.askMaxTurns } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.authorModel !== undefined ? { authorModel: opts.authorModel } : {}),
      ...(opts.askModel !== undefined ? { askModel: opts.askModel } : {}),
    });
  }
  if (spec.startsWith('recorded:')) {
    const given = LIVE_FLAGS.filter(([key]) => opts[key] !== undefined).map(([, flag]) => flag);
    if (given.length) throw new Error(`${given.join(', ')} ${given.length === 1 ? 'applies' : 'apply'} to the live driver only: a replay re-reads each turn as it was recorded`);
    return RecordedDriver.fromFile(spec.slice('recorded:'.length));
  }
  throw new Error(`unknown driver \`${spec}\` (claude, recorded:FILE)`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = findUp(here, (d) => existsSync(join(d, 'pnpm-workspace.yaml')));
  const cardsDir = resolve(args.cards ?? join(repo, 'docs/qa/scenarios'));
  const outDir = resolve(args.out ?? join(repo, 'docs/qa/platform-checklist/runs'));
  const work = resolve(args.work ?? mkdtempSync(join(tmpdir(), 'scenario-run-')));
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const { cards, refusals } = loadScenarios(cardsDir, {
    areas: readCapabilityAreas(join(repo, 'docs/qa/platform-checklist/areas')),
    library: libraryOf(cardsDir, repo),
  });
  for (const r of refusals) console.error(formatRefusal(r));
  const chosen = args.only ? cards.filter((c) => args.only!.includes(c.card.id)) : cards;
  if (chosen.length === 0) {
    console.error(`no card to run under ${cardsDir}${args.only ? ` matching ${args.only.join(',')}` : ''}`);
    return 2;
  }

  const live = makeDriver(args.driver, args);
  const driver = args.record ? new RecordingDriver(live) : live;
  const info = driver.info();
  console.log(
    `driver: ${info.driver} ${info.version ?? ''} · login: ${info.authMethod ?? 'n/a'} · API-billed: no` +
      (info.authorTimeoutMs !== undefined ? ` · author timeout: ${minutesText(info.authorTimeoutMs)}` : '') +
      (info.authorMaxTurns ? ` · author max turns: ${Object.entries(info.authorMaxTurns).map(([tier, n]) => `${tier} ${n}`).join(', ')}` : '') +
      (info.askMaxTurns !== undefined ? ` · ask max turns: ${info.askMaxTurns}` : '') +
      (info.authorModel ? ` · author model: ${info.authorModel}` : '') +
      (info.askModel ? ` · ask model: ${info.askModel}` : ''),
  );

  // Built and packed once, before the first card: every scaffold of this run installs the same tarballs.
  const workspace = args.packages === 'workspace' ? await prepareWorkspacePackages(repo, join(work, 'workspace-packages')) : undefined;
  if (workspace) console.log(`packages: workspace @ ${workspace.source.commit}${workspace.source.uncommitted ? ' + uncommitted changes' : ''} — ${workspace.tarballs.size} packed under ${join(work, 'workspace-packages')}`);
  /** The `@objectstack/spec` versions the current card's published scaffolds installed. */
  let publishedVersions = new Set<string>();

  const ops: ProjectOps = {
    scaffold: async (name, under) => {
      const parent = join(work, under);
      mkdirSync(parent, { recursive: true });
      if (workspace) {
        const done = await scaffold(parent, name, workspaceScaffolder(workspace));
        if (done.result.exit !== 0) return done;
        return { dir: done.dir, result: await settleWorkspaceProject(done.dir, workspace) };
      }
      const done = await scaffold(parent, name, args.createVersion ? { version: args.createVersion } : {});
      const version = installedSpecVersion(done.dir);
      if (version) publishedVersions.add(version);
      return done;
    },
    os: (dir, a) => os(dir, a),
    readArtifact,
    namespace: readNamespace,
    boot: (dir) => bootDev(dir),
    harness: (url) => new HttpApp({ baseUrl: url, adminEmail: ADMIN.email, adminPassword: ADMIN.password }),
  };
  const template = args.template ? JSON.parse(readFileSync(args.template, 'utf8')) : undefined;
  let framework: string | undefined;
  try {
    framework = execSync('git rev-parse --short HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    /* not a checkout */
  }
  const date = new Date().toISOString().slice(0, 10);

  for (const scenario of chosen) {
    console.log(`\n▶ ${scenario.card.id} (${args.modes.join(' + ')})`);
    publishedVersions = new Set();
    const cardRun = await runCard(scenario, driver, ops, { modes: args.modes, iterateRun: args.iterateRun, admin: ADMIN, ...(template ? { templateArtifact: template } : {}) });
    const packages: PackageSource = workspace ? workspace.source : { source: 'published', versions: [...publishedVersions].sort() };
    const record = runRecord({ run: `${date}-scenario-${scenario.card.id}`, date, ...(framework ? { framework } : {}), packages, driver: info, runner: 'scenario-runner', evidenceDir: work }, cardRun);
    const file = join(outDir, `${date}-scenario-${scenario.card.id}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2));
    console.log(renderScorecard(cardScorecard(cardRun, packages)));
    console.log(`record: ${file}`);
    if (driver instanceof RecordingDriver && args.record) driver.save(args.record);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
