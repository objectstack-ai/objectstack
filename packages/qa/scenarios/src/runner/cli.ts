// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios run-scenarios [flags]` — run every card
 * under `docs/qa/scenarios/` end to end and write one run record per card.
 *
 *   --cards DIR          the card directory (default: the repo's docs/qa/scenarios)
 *   --only ID[,ID]       run only these cards
 *   --modes M[,M]        scratch, template (default: both)
 *   --driver claude      the local Claude Code CLI on your own login (default)
 *   --driver recorded:F  replay the recording F (no model, no network to a model)
 *   --record F           also save every live turn to F, for later replay
 *   --template F         a verified build (dist/objectstack.json) for template mode
 *   --no-iterate-run     skip the Run half after the iterate (scratch mode)
 *   --out DIR            where records go (default docs/qa/platform-checklist/runs, git-ignored)
 *   --work DIR           where projects are scaffolded (default: a temp dir)
 *   --create-version V   the create-objectstack version (default latest)
 *
 * ⛔ No API-billed model: the live driver refuses to start when an API key is
 * configured (the cost ruling on cloud#3600).
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatRefusal, loadScenarios, readCapabilityAreas } from '../loader.js';
import { HttpApp } from './app.js';
import { ClaudeCodeDriver, RecordedDriver, RecordingDriver, type AgentDriver } from './driver.js';
import { runCard, type ProjectOps } from './orchestrate.js';
import { bootDev, os, readArtifact, readNamespace, scaffold } from './project.js';
import { cardScorecard, renderScorecard, runRecord } from './scorecard.js';

const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

function findUp(start: string, test: (dir: string) => boolean): string {
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
    else if (flag === '--out') a.out = val();
    else if (flag === '--work') a.work = val();
    else if (flag === '--create-version') a.createVersion = val();
    else throw new Error(`unknown flag \`${flag}\``);
  }
  return a;
}

export function makeDriver(spec: string): AgentDriver {
  if (spec === 'claude') return new ClaudeCodeDriver();
  if (spec.startsWith('recorded:')) return RecordedDriver.fromFile(spec.slice('recorded:'.length));
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

  const { cards, refusals } = loadScenarios(cardsDir, { areas: readCapabilityAreas(join(repo, 'docs/qa/platform-checklist/areas')) });
  for (const r of refusals) console.error(formatRefusal(r));
  const chosen = args.only ? cards.filter((c) => args.only!.includes(c.card.id)) : cards;
  if (chosen.length === 0) {
    console.error(`no card to run under ${cardsDir}${args.only ? ` matching ${args.only.join(',')}` : ''}`);
    return 2;
  }

  const live = makeDriver(args.driver);
  const driver = args.record ? new RecordingDriver(live) : live;
  const info = driver.info();
  console.log(`driver: ${info.driver} ${info.version ?? ''} · login: ${info.authMethod ?? 'n/a'} · API-billed: no`);

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
    framework = execSync('git rev-parse --short HEAD', { cwd: repo, encoding: 'utf8' }).trim();
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
