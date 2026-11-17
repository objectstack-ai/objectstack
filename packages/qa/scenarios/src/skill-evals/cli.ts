// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios skill-evals` — run the published
 * skills' existing eval cases (`skills/BUNDLE/evals/*.json`) through the local
 * Claude Code login, each case on a with-skill and a no-skill arm, graded by
 * the case's own `must_contain` / `must_not_contain`. A devx instrument run
 * from this checkout: not a CI job, not a merge gate, not in the package's
 * published `bin` or `exports`. README section "Running the published skills'
 * eval cases" is the operator's page.
 *
 *   --skills a,b          only these bundles (a touched skill); default every bundle with cases
 *   --skills-from SOURCE  `workspace` (default: this checkout's skills/) or an
 *                         `@objectstack/skills` version (`18.5.0`), packed from npm;
 *                         cases and bundles both come from SOURCE
 *   --repeats N           turns per case per arm (default 1)
 *   --concurrency N       turns at once (default 2)
 *   --max-turns N         `--max-turns` per turn (default 16)
 *   --case-timeout MIN    wall-clock budget per turn, minutes (default 5)
 *   --max-utilization F   stop scheduling turns once the login's rate-limit window
 *                         reports this utilization or `rejected` (default 0.9)
 *   --model M / --effort L   asked of every turn; absent ⇒ the login's / CLI's default
 *   --bin PATH            the `claude` executable (default `claude`)
 *   --out DIR             where the round goes (default
 *                         docs/qa/platform-checklist/runs/skill-evals/ROUND, git-ignored)
 *   --dry-run             print the plan and both arms' argv; no login read, no model call
 *   --self-test           the runner's own fixtures, both directions; no model call
 *
 * Exit: 0 the round ran to its end (a measurement, whatever its pass rates);
 *       1 refused or could not run (an API-billed login, an unknown bundle, a
 *         refused eval file, a failed self-test);
 *       3 the round stopped early on the rate-limit window: what ran is
 *         recorded, the rest is recorded as not run.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { armArgs, ARMS } from './arms.js';
import { loadSkillEvalCatalog, selectBundles } from './cases.js';
import { executeRound, planRound, preflight, type SkillEvalRunRecord } from './run.js';
import { runSelfTest, selfTestReached } from './self-test.js';
import { renderSummaryMarkdown, summariseRound } from './summary.js';

export const ROUND_RECORD_SCHEMA = 'skill-eval-round/1';

export interface SkillEvalArgs {
  skills?: string[];
  skillsFrom: string;
  repeats: number;
  concurrency: number;
  maxTurns: number;
  caseTimeoutMin: number;
  maxUtilization: number;
  model?: string;
  effort?: string;
  bin: string;
  out?: string;
  dryRun: boolean;
  selfTest: boolean;
  help: boolean;
}

const positiveInt = (flag: string, raw: string | undefined): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} takes a whole number of at least 1, not \`${raw ?? ''}\``);
  return n;
};

/** Parse argv; an unknown flag or a flag missing its value is refused. Pure over its input. */
export function parseSkillEvalArgs(argv: readonly string[]): SkillEvalArgs {
  const a: SkillEvalArgs = { skillsFrom: 'workspace', repeats: 1, concurrency: 2, maxTurns: 16, caseTimeoutMin: 5, maxUtilization: 0.9, bin: 'claude', dryRun: false, selfTest: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--skills') a.skills = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--skills-from') a.skillsFrom = val();
    else if (flag === '--repeats') a.repeats = positiveInt(flag, val());
    else if (flag === '--concurrency') a.concurrency = positiveInt(flag, val());
    else if (flag === '--max-turns') a.maxTurns = positiveInt(flag, val());
    else if (flag === '--case-timeout') {
      const raw = val();
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--case-timeout takes a number of minutes above 0, not \`${raw}\``);
      a.caseTimeoutMin = n;
    } else if (flag === '--max-utilization') {
      const raw = val();
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error(`--max-utilization takes a fraction in (0, 1], not \`${raw}\``);
      a.maxUtilization = n;
    } else if (flag === '--model') a.model = val();
    else if (flag === '--effort') a.effort = val();
    else if (flag === '--bin') a.bin = val();
    else if (flag === '--out') a.out = val();
    else if (flag === '--dry-run') a.dryRun = true;
    else if (flag === '--self-test') a.selfTest = true;
    else if (flag === '--help' || flag === '-h') a.help = true;
    else throw new Error(`unknown flag \`${flag}\` (see --help)`);
  }
  return a;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The checkout root: the nearest directory above this file holding `pnpm-workspace.yaml`. */
function repoRoot(): string {
  for (let d = HERE; ; d = dirname(d)) {
    if (existsSync(join(d, 'pnpm-workspace.yaml'))) return d;
    if (dirname(d) === d) throw new Error(`no pnpm-workspace.yaml above ${HERE}: the skill-evals runner runs from an ObjectStack checkout`);
  }
}

interface SkillsSource {
  root: string;
  label: string;
  cleanup: () => void;
}

/** `workspace` → this checkout's `skills/`; a version → `npm pack @objectstack/skills@VERSION`'s `dist/skills/`. */
function resolveSkillsSource(from: string, repo: string): SkillsSource {
  if (from === 'workspace') return { root: join(repo, 'skills'), label: 'workspace skills/', cleanup: () => {} };
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(from)) throw new Error(`--skills-from takes \`workspace\` or an exact @objectstack/skills version (\`18.5.0\`), not \`${from}\``);
  const dir = mkdtempSync(join(tmpdir(), 'skill-evals-pack-'));
  try {
    const tgz = execFileSync('npm', ['pack', `@objectstack/skills@${from}`, '--pack-destination', dir, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop()!;
    execFileSync('tar', ['-xzf', join(dir, tgz), '-C', dir]);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not pack @objectstack/skills@${from}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { root: join(dir, 'package', 'dist', 'skills'), label: `published @objectstack/skills@${from}`, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runnerSha(repo: string): string {
  const head = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) return 'unknown';
  const dirty = spawnSync('git', ['-C', repo, 'status', '--porcelain', '--', 'packages/qa/scenarios/src/skill-evals', 'skills'], { encoding: 'utf8' });
  return head.stdout.trim() + (dirty.stdout.trim() ? ' (with uncommitted changes under the runner or skills/)' : '');
}

const HELP = `skill-evals — run the published skills' eval cases on a with-skill and a no-skill arm
  pnpm --filter @objectstack/scenarios skill-evals [--skills a,b] [--skills-from workspace|VERSION] [--repeats N]
       [--concurrency N] [--max-turns N] [--case-timeout MIN] [--max-utilization F] [--model M] [--effort L]
       [--bin PATH] [--out DIR] [--dry-run] [--self-test]
See packages/qa/scenarios/README.md, "Running the published skills' eval cases".`;

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseSkillEvalArgs(argv);
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const repo = repoRoot();

  if (args.selfTest) {
    const r = runSelfTest({ skillsRoot: join(repo, 'skills') });
    if (!selfTestReached()) {
      console.error('\n✗ skill-evals self-test: it returned without reaching its verdict, so no success line was printed. Exiting 0 here would report a self-test that never finished as one that passed.');
      return 1;
    }
    return r.failed === 0 ? 0 : 1;
  }

  // The login guard first: a live round refuses an API-billed configuration before it reads or packs anything.
  const pf = args.dryRun ? undefined : preflight(args.bin, process.env, undefined, args.effort);
  const source = resolveSkillsSource(args.skillsFrom, repo);
  try {
    const catalog = loadSkillEvalCatalog(source.root);
    if (catalog.refusals.length) {
      for (const r of catalog.refusals) console.error(`${r.path}: ${r.message}`);
      throw new Error(`${catalog.refusals.length} eval file or case refused under ${source.root}; the runner grades only cases it can read whole`);
    }
    const cases = selectBundles(catalog, args.skills);
    const jobs = planRound(cases, args.repeats);
    const bundles = [...new Set(cases.map((c) => c.bundle))];
    const turnOpts = { maxTurns: args.maxTurns, ...(args.model ? { model: args.model } : {}), ...(args.effort ? { effort: args.effort } : {}) };

    if (args.dryRun) {
      console.log(`skills: ${source.label} (${source.root})`);
      for (const b of bundles) console.log(`  ${b}: ${cases.filter((c) => c.bundle === b).length} case(s)`);
      console.log(`${cases.length} case(s) × ${ARMS.length} arms × ${args.repeats} repeat(s) = ${jobs.length} turn(s), ${args.concurrency} at once`);
      console.log(`each turn: a fresh directory; with-skill holds .claude/skills/BUNDLE/ (no evals/), no-skill holds nothing`);
      console.log(`argv (prompt on stdin): ${args.bin} ${armArgs('TURN_DIR/mcp.json', turnOpts).join(' ')}`);
      console.log('dry run: no login read, no model called, nothing written');
      return 0;
    }

    if (!pf) throw new Error('unreachable: a live round has passed its preflight');
    const startedAt = new Date();
    const roundId = `${startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-skill-evals`;
    const outDir = resolve(args.out ?? join(repo, 'docs', 'qa', 'platform-checklist', 'runs', 'skill-evals', roundId));
    mkdirSync(outDir, { recursive: true });
    if (readdirSync(join(outDir)).some((f) => f === 'round.json')) throw new Error(`${outDir} already holds a round.json: pass a fresh --out`);
    console.log(`skill-evals: ${jobs.length} turn(s) (${cases.length} case(s) × ${ARMS.length} arms × ${args.repeats}), ${args.concurrency} at once, ${pf.version}, login ${pf.authMethod}`);
    console.log(`records: ${outDir}`);

    const exec = await executeRound(jobs, {
      bin: args.bin,
      skillsRoot: source.root,
      catalogBundles: catalog.bundles,
      outDir,
      maxTurns: args.maxTurns,
      caseTimeoutMs: Math.round(args.caseTimeoutMin * 60_000),
      concurrency: args.concurrency,
      maxUtilization: args.maxUtilization,
      ...(args.model ? { model: args.model } : {}),
      ...(args.effort ? { effort: args.effort } : {}),
      onRecord: (r: SkillEvalRunRecord, done, total) => console.log(`[${done}/${total}] ${r.verdict.padEnd(7)} ${r.arm.padEnd(10)} ${r.key}${r.reason ? ` — ${r.reason}` : ''}`),
    });
    const finishedAt = new Date();
    const summary = summariseRound(cases, exec.records, exec.notRun);
    const servedModels = [...new Set(exec.records.map((r) => r.model).filter((m): m is string => !!m))].sort();
    const sha = runnerSha(repo);
    const wallMin = Math.round((finishedAt.getTime() - startedAt.getTime()) / 6000) / 10;
    const round = {
      schema: ROUND_RECORD_SCHEMA,
      round: roundId,
      runner: { repo: 'objectstack-ai/objectstack', sha },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      wallMs: finishedAt.getTime() - startedAt.getTime(),
      skills: { source: source.label, bundles },
      driver: {
        driver: 'claude-code-cli',
        version: pf.version,
        authMethod: pf.authMethod,
        apiBilled: false,
        servedModels,
        ...(args.model ? { requestedModel: args.model } : {}),
        ...(args.effort ? { requestedEffort: args.effort } : {}),
        maxTurns: args.maxTurns,
        caseTimeoutMs: Math.round(args.caseTimeoutMin * 60_000),
        concurrency: args.concurrency,
        maxUtilization: args.maxUtilization,
      },
      scope: { cases: cases.length, arms: [...ARMS], repeats: args.repeats, plannedTurns: jobs.length, ranTurns: exec.records.length, notRunTurns: exec.notRun.length },
      ...(exec.stopped ? { stopped: exec.stopped } : {}),
      summary,
    };
    writeFileSync(join(outDir, 'round.json'), JSON.stringify(round, null, 2) + '\n');
    const head = {
      title: `Skill evals · ${bundles.length === catalog.bundles.length ? 'all bundles' : bundles.join(', ')} × 2 arms × ${args.repeats} rep${args.repeats === 1 ? '' : 's'}`,
      lines: [
        `runner: objectstack-ai/objectstack ${sha}`,
        `skills: ${source.label}`,
        `driver: claude-code-cli ${pf.version}, login \`${pf.authMethod}\`, no API key; served ${servedModels.join(', ') || 'none'}; effort ${args.effort ?? 'CLI default'}`,
        `turns: ${exec.records.length} of ${jobs.length} ran (${cases.length} cases × 2 arms × ${args.repeats}), ${args.concurrency} at once, --max-turns ${args.maxTurns}`,
        `wall time: ${wallMin} min; notional cost the CLI reported: $${summary.reportedCostUsd} (subscription login, nothing billed)`,
      ],
      ...(exec.stopped ? { stopped: exec.stopped } : {}),
    };
    writeFileSync(join(outDir, 'summary.md'), renderSummaryMarkdown(summary, head));
    writeFileSync(join(outDir, 'summary.github.md'), renderSummaryMarkdown(summary, head, { forGitHub: true }));
    console.log(`\n${renderSummaryMarkdown({ ...summary, cases: [] }, head).split('## Per case')[0]}`);
    console.log(`round: ${join(outDir, 'round.json')} · summary: ${join(outDir, 'summary.md')}`);
    return exec.stopped ? 3 : 0;
  } finally {
    source.cleanup();
  }
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
