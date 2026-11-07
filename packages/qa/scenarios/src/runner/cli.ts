// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios run-scenarios [flags]` — run every card
 * under `docs/qa/scenarios/` end to end and write one run record per card.
 *
 *   --cards DIR          the card directory (default: the repo's docs/qa/scenarios,
 *                        or the copy the published package carries, `library.ts`);
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
 *   --template F         a verified build (dist/objectstack.json) for template mode
 *   --no-iterate-run     skip the Run half after the iterate (scratch mode)
 *   --out DIR            where records go (default docs/qa/platform-checklist/runs, git-ignored;
 *                        ./scenario-runs when run from the published package)
 *   --work DIR           where projects are scaffolded (default: a temp dir)
 *   --create-version V   the create-objectstack version (default latest)
 *
 * ⛔ No API-billed model: the live driver refuses to start when an API key is
 * configured (the cost ruling on cloud#3600).
 */

import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatRefusal, libraryOf, loadScenarios, readCapabilityAreas } from '../loader.js';
import { HttpApp } from './app.js';
import { ClaudeCodeDriver, RecordedDriver, RecordingDriver, type AgentDriver } from './driver.js';
import { CAPABILITY_AREAS_DIR, locateLibraryRoot } from './library.js';
import { minutesText, runCard, type ProjectOps } from './orchestrate.js';
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
  out?: string;
  work?: string;
  createVersion?: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const a: CliArgs = { modes: ['scratch', 'template'], driver: 'claude', iterateRun: true };
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
    else if (flag === '--out') a.out = val();
    else if (flag === '--work') a.work = val();
    else if (flag === '--create-version') a.createVersion = val();
    else throw new Error(`unknown flag \`${flag}\``);
  }
  return a;
}

/** The live driver's limits a run may set: `--author-timeout`, `--author-max-turns`, `--ask-max-turns`. */
export type DriverLimits = Pick<CliArgs, 'authorTimeoutMin' | 'authorMaxTurns' | 'askMaxTurns'>;

const LIMIT_FLAGS: ReadonlyArray<readonly [keyof DriverLimits, string]> = [
  ['authorTimeoutMin', '--author-timeout'],
  ['authorMaxTurns', '--author-max-turns'],
  ['askMaxTurns', '--ask-max-turns'],
];

export function makeDriver(spec: string, opts: DriverLimits = {}): AgentDriver {
  if (spec === 'claude') {
    return new ClaudeCodeDriver({
      ...(opts.authorTimeoutMin !== undefined ? { authorTimeoutMs: opts.authorTimeoutMin * 60_000 } : {}),
      ...(opts.authorMaxTurns !== undefined ? { authorMaxTurns: opts.authorMaxTurns } : {}),
      ...(opts.askMaxTurns !== undefined ? { askMaxTurns: opts.askMaxTurns } : {}),
    });
  }
  if (spec.startsWith('recorded:')) {
    const given = LIMIT_FLAGS.filter(([key]) => opts[key] !== undefined).map(([, flag]) => flag);
    if (given.length) throw new Error(`${given.join(', ')} ${given.length === 1 ? 'applies' : 'apply'} to the live driver only: a replay re-reads each turn as it was recorded`);
    return RecordedDriver.fromFile(spec.slice('recorded:'.length));
  }
  throw new Error(`unknown driver \`${spec}\` (claude, recorded:FILE)`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const here = dirname(fileURLToPath(import.meta.url));
  // The checkout, or the library root the published package carries (`library.ts`).
  const { root: repo, checkout } = locateLibraryRoot(here);
  const cardsDir = resolve(args.cards ?? join(repo, 'docs/qa/scenarios'));
  const outDir = resolve(args.out ?? (checkout ? join(repo, 'docs/qa/platform-checklist/runs') : 'scenario-runs'));
  const work = resolve(args.work ?? mkdtempSync(join(tmpdir(), 'scenario-run-')));
  mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const { cards, refusals } = loadScenarios(cardsDir, {
    areas: readCapabilityAreas(join(repo, CAPABILITY_AREAS_DIR)),
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
      (info.askMaxTurns !== undefined ? ` · ask max turns: ${info.askMaxTurns}` : ''),
  );

  const ops: ProjectOps = {
    scaffold: (name, under) => {
      const parent = join(work, under);
      mkdirSync(parent, { recursive: true });
      return scaffold(parent, name, args.createVersion ? { version: args.createVersion } : {});
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
    // Only a checkout has a framework commit: an installed package may sit in someone else's repository.
    if (checkout) framework = execSync('git rev-parse --short HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  } catch {
    /* not a checkout */
  }
  const date = new Date().toISOString().slice(0, 10);

  for (const scenario of chosen) {
    console.log(`\n▶ ${scenario.card.id} (${args.modes.join(' + ')})`);
    const cardRun = await runCard(scenario, driver, ops, { modes: args.modes, iterateRun: args.iterateRun, admin: ADMIN, ...(template ? { templateArtifact: template } : {}) });
    const record = runRecord({ run: `${date}-scenario-${scenario.card.id}`, date, ...(framework ? { framework } : {}), driver: info, runner: 'scenario-runner', evidenceDir: work }, cardRun);
    const file = join(outDir, `${date}-scenario-${scenario.card.id}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2));
    console.log(renderScorecard(cardScorecard(cardRun)));
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
