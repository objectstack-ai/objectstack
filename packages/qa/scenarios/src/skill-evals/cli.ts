// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `pnpm --filter @objectstack/scenarios skill-evals` — run the published
 * skills' existing eval cases (`skills/BUNDLE/evals/*.json`) through the local
 * Claude Code login, each case on a with-skill and a no-skill arm, graded by
 * the case's own `must_contain` / `must_not_contain`; a trigger case
 * (`should_trigger`) runs on the with-skill arm only, graded on whether the
 * turn loaded the bundle, and is reported beside them. A devx instrument run
 * from this checkout: not a CI job, not a merge gate, not in the package's
 * published `bin` or `exports`. README section "Running the published skills'
 * eval cases" is the operator's page.
 *
 *   --skills a,b          only these bundles (a touched skill); default every bundle with cases
 *   --skills-from SOURCE  `workspace` (default: this checkout's skills/) or an
 *                         `@objectstack/skills` version (`18.5.0`), packed from npm;
 *                         cases and bundles both come from SOURCE
 *   --triggers-only       only the selected bundles' trigger cases (`should_trigger`), on
 *                         the with-skill arm; refused beside --regrade or --self-test
 *   --trigger-field F     what a trigger turn's project holds beside its bundle: `selection`
 *                         (default: every --skills bundle, or every bundle) or `own` (it alone,
 *                         as rounds recorded before); refused beside --regrade or --self-test
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
 *   --regrade DIR         re-draw a recorded round's verdicts under this runner's rules,
 *                         from the answers on its records; no login read, no model call
 *   --self-test           the runner's own fixtures, both directions; no model call
 *
 * Exit: 0 the round ran to its end (a measurement, whatever its pass rates);
 *       1 refused or could not run (an API-billed login, an unknown bundle, a
 *         refused eval file, a failed self-test);
 *       3 the round stopped early on the rate-limit window: what ran is
 *         recorded, the rest is recorded as not run.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { armArgs, ARMS } from './arms.js';
import { loadSkillEvalCatalog, selectBundles, type SkillEvalCatalog } from './cases.js';
import { executeRound, planRound, preflight, regradeRecords, type RoundStop, runRecordFile, type SkillEvalRunRecord } from './run.js';
import { runSelfTest, selfTestReached } from './self-test.js';
import { renderSummaryMarkdown, type RoundSummary, summariseRound } from './summary.js';

export const ROUND_RECORD_SCHEMA = 'skill-eval-round/1';

export const TRIGGER_FIELDS = ['selection', 'own'] as const;
export type TriggerField = (typeof TRIGGER_FIELDS)[number];

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
  regrade?: string;
  triggersOnly: boolean;
  /** `--trigger-field`; absent ⇒ `selection`. */
  triggerField?: TriggerField;
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
  const a: SkillEvalArgs = { skillsFrom: 'workspace', repeats: 1, concurrency: 2, maxTurns: 16, caseTimeoutMin: 5, maxUtilization: 0.9, bin: 'claude', triggersOnly: false, dryRun: false, selfTest: false, help: false };
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
    else if (flag === '--regrade') a.regrade = val();
    else if (flag === '--triggers-only') a.triggersOnly = true;
    else if (flag === '--trigger-field') {
      const v = val();
      if (!(TRIGGER_FIELDS as readonly string[]).includes(v)) throw new Error(`--trigger-field takes ${TRIGGER_FIELDS.join(' or ')}, not \`${v}\``);
      a.triggerField = v as TriggerField;
    }
    else if (flag === '--dry-run') a.dryRun = true;
    else if (flag === '--self-test') a.selfTest = true;
    else if (flag === '--help' || flag === '-h') a.help = true;
    else throw new Error(`unknown flag \`${flag}\` (see --help)`);
  }
  // Refused, never ignored: neither of these reads a selection the flag could narrow.
  if (a.triggersOnly && a.regrade !== undefined) throw new Error('--triggers-only cannot narrow --regrade: a regrade re-draws the recorded round at the scope it ran, so a --triggers-only round regrades as one without the flag');
  if (a.triggersOnly && a.selfTest) throw new Error('--triggers-only cannot narrow --self-test: the self-test runs its own fixtures, never a selection of cases');
  if (a.triggerField && (a.regrade !== undefined || a.selfTest)) throw new Error(`--trigger-field cannot apply to ${a.selfTest ? '--self-test: the self-test runs its own fixtures' : '--regrade: a regrade runs no turn, and keeps the installed set its round recorded'}`);
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

export interface RoundRecord {
  schema: typeof ROUND_RECORD_SCHEMA;
  round: string;
  runner: { repo: string; sha: string };
  startedAt: string;
  finishedAt: string;
  wallMs: number;
  skills: { source: string; bundles: string[]; allBundles: boolean };
  driver: {
    driver: 'claude-code-cli';
    version: string;
    authMethod: string;
    apiBilled: false;
    servedModels: string[];
    requestedModel?: string;
    requestedEffort?: string;
    maxTurns: number;
    caseTimeoutMs: number;
    concurrency: number;
    maxUtilization: number;
  };
  /** `triggersOnly`: the round ran `--triggers-only` (its trigger cases alone, on the with-skill arm), and `--regrade` keeps that scope. */
  scope: { cases: number; arms: string[]; repeats: number; plannedTurns: number; ranTurns: number; notRunTurns: number; triggersOnly?: true };
  /** What every trigger turn installed beside its bundle (`--trigger-field`); absent on a round recorded before ⇒ `own`. */
  triggerField?: { mode: TriggerField; bundles?: string[] };
  stopped?: RoundStop;
  /**
   * Set by `--regrade`: when, by which runner, and how many verdicts now differ
   * from the ones the turns were given; then what the regrade could not apply
   * the rules to. `setApart` cases (changed since the round, or removed) are not
   * regraded and are out of the summary; `unhashed` records predate case hashes
   * and were regraded against the cases as they are now; `added` cases were never
   * planned by the round and are left out. A record regraded before these
   * fields existed carries none of them.
   */
  regraded?: { at: string; sha: string; changed: number; unhashed?: number; setApart?: { changed: string[]; removed: string[] }; added?: string[] };
  summary: RoundSummary;
}

/** The summary's header lines for a regraded round: what was regraded, and what was not and why. */
export function regradedLines(g: NonNullable<RoundRecord['regraded']>): string[] {
  const names = (keys: readonly string[]) => keys.map((k) => `\`${k}\``).join(', ');
  const apart = g.setApart ?? { changed: [], removed: [] };
  return [
    `regraded ${g.at} by runner ${g.sha}: ${g.changed} verdict(s) differ from the ones the turns were given, no model asked`,
    ...(apart.changed.length ? [`${apart.changed.length} case(s) changed since the round, set apart: not regraded and out of every pass rate below: ${names(apart.changed)}`] : []),
    ...(apart.removed.length ? [`${apart.removed.length} case(s) no longer in the catalog, set apart: not regraded and out of every pass rate below: ${names(apart.removed)}`] : []),
    ...(g.unhashed ? [`${g.unhashed} record(s) carry no case hash (written before the runner hashed cases): regraded against the cases as they are now, which nothing shows are the cases that ran`] : []),
    ...(g.added?.length ? [`${g.added.length} case(s) added since the round, left out: the round never ran them`] : []),
  ];
}

/** `N behaviour case(s) × 2 arms [+ M trigger case(s) × the with-skill arm], × R`; the behaviour part only when there is one, or nothing else. Pure. */
export const turnsLine = (behaviour: number, trigger: number, repeats: number): string =>
  `${[behaviour || !trigger ? `${behaviour} behaviour case(s) × ${ARMS.length} arms` : '', trigger ? `${trigger} trigger case(s) × the with-skill arm` : ''].filter(Boolean).join(' + ')}, × ${repeats}`;

/** The summary header's account of what a trigger turn's project held. Pure. */
export const triggerFieldLine = (f: RoundRecord['triggerField']): string =>
  f?.mode === 'selection'
    ? `trigger turns installed the round's selection, ${f.bundles?.length ?? 0} bundle(s): ${(f.bundles ?? []).join(', ')} (--trigger-field selection)`
    : `trigger turns installed their own bundle alone (${f ? '--trigger-field own' : 'a round recorded before --trigger-field, which always did'})`;

/** `round.json`, `summary.md` and `summary.github.md` into `outDir`, and the per-bundle tables on stdout. */
export function writeRoundOutputs(outDir: string, round: RoundRecord): void {
  writeFileSync(join(outDir, 'round.json'), JSON.stringify(round, null, 2) + '\n');
  const { driver: d, scope } = round;
  const wallMin = Math.round(round.wallMs / 6000) / 10;
  const head = {
    title: `Skill evals · ${round.skills.allBundles ? 'all bundles' : round.skills.bundles.join(', ')} × ${scope.triggersOnly ? 'trigger cases × the with-skill arm' : '2 arms'} × ${scope.repeats} rep${scope.repeats === 1 ? '' : 's'}`,
    lines: [
      `runner: ${round.runner.repo} ${round.runner.sha}`,
      `skills: ${round.skills.source}`,
      `driver: ${d.driver} ${d.version}, login \`${d.authMethod}\`, no API key; served ${d.servedModels.join(', ') || 'none'}; effort ${d.requestedEffort ?? 'CLI default'}`,
      `turns: ${scope.ranTurns} of ${scope.plannedTurns} ran (${turnsLine(round.summary.cases.length, round.summary.triggers?.cases.length ?? 0, scope.repeats)}), ${d.concurrency} at once, --max-turns ${d.maxTurns}`,
      `wall time: ${wallMin} min; notional cost the CLI reported: $${round.summary.reportedCostUsd} (subscription login, nothing billed)`,
      ...(round.summary.triggers?.cases.length ? [triggerFieldLine(round.triggerField)] : []),
      ...(round.regraded ? regradedLines(round.regraded) : []),
    ],
    ...(round.stopped ? { stopped: round.stopped } : {}),
  };
  writeFileSync(join(outDir, 'summary.md'), renderSummaryMarkdown(round.summary, head));
  writeFileSync(join(outDir, 'summary.github.md'), renderSummaryMarkdown(round.summary, head, { forGitHub: true }));
  const md = renderSummaryMarkdown(round.summary, head);
  const triggerTable = md.includes('\n## Trigger cases') ? md.slice(md.indexOf('\n## Trigger cases')).split('\n| trigger case |')[0] : '';
  console.log(`\n${md.split(/## (?:Per case|Trigger cases)/)[0]}${triggerTable}`);
  console.log(`round: ${join(outDir, 'round.json')} · summary: ${join(outDir, 'summary.md')}`);
}

/**
 * `--regrade DIR`: re-draw every recorded turn's verdict under this runner's
 * rules from the answer and arm facts on its record (no login read, no model
 * asked), and rewrite the round's records and summary. The catalog must be the
 * one the round ran on (`--skills-from` naming the same source).
 *
 * A case reworded since the round is set apart, never regraded: its records
 * are left as they are and it is named apart from the pass rates, which are
 * drawn over the unchanged cases only (`regradeRecords`). Refusing the whole
 * regrade instead would leave every round before a reword unregradeable, and
 * regrading it would mix the old answers with the new assertions.
 */
export function regradeRound(dir: string, catalog: SkillEvalCatalog, sourceLabel: string): number {
  const roundFile = join(dir, 'round.json');
  if (!existsSync(roundFile)) throw new Error(`--regrade: ${dir} holds no round.json`);
  const round = JSON.parse(readFileSync(roundFile, 'utf8')) as RoundRecord;
  if (round.schema !== ROUND_RECORD_SCHEMA) throw new Error(`--regrade: ${roundFile} is not a \`${ROUND_RECORD_SCHEMA}\` record`);
  if (round.skills.source !== sourceLabel) throw new Error(`--regrade: the round ran on ${round.skills.source}, not ${sourceLabel}; pass the same --skills-from`);
  // The bundles may have left the catalog too; their cases are then set apart as removed.
  const present = round.skills.bundles.filter((b) => catalog.bundles.includes(b));
  // A `--triggers-only` round planned its trigger cases alone: its behaviour cases are not `added` since.
  const catalogCases = present.length ? catalog.cases.filter((c) => present.includes(c.bundle) && (!round.scope.triggersOnly || c.shouldTrigger !== undefined)) : [];
  const view = { bundles: catalog.bundles, unlisted: catalog.unlistedBundles };
  const runsDir = join(dir, 'runs');
  const files = readdirSync(runsDir).filter((n) => n.endsWith('.json')).sort();
  const recorded = files.map((f) => ({ f, rec: JSON.parse(readFileSync(join(runsDir, f), 'utf8')) as SkillEvalRunRecord }));
  // The cases the round planned: its summary's, plus any an earlier regrade set apart (and so left out of it).
  const before = round.regraded?.setApart;
  // A round recorded before trigger cases existed has no `triggers`.
  const plannedKeys = [...new Set([...round.summary.cases.map((c) => c.key), ...(round.summary.triggers?.cases ?? []).map((c) => c.key), ...(before?.changed ?? []), ...(before?.removed ?? [])])];
  const out = regradeRecords(recorded.map((r) => r.rec), plannedKeys, catalogCases, view);
  const byKey = new Map(out.cases.map((c) => [c.key, c]));
  const regraded = new Map(out.records.map((r) => [`${r.key}|${r.arm}|${r.repeat}`, r]));
  for (const { f, rec } of recorded) {
    const next = regraded.get(`${rec.key}|${rec.arm}|${rec.repeat}`);
    if (next) writeFileSync(join(runsDir, f), JSON.stringify(next, null, 2) + '\n');
  }
  const ran = new Set(out.records.filter((r) => byKey.has(r.key)).map((r) => runRecordFile({ case: byKey.get(r.key)!, arm: r.arm, repeat: r.repeat })));
  const notRun = planRound(out.cases, round.scope.repeats).filter((j) => !ran.has(runRecordFile(j)));
  // A round recorded before `allBundles` existed: read it off the catalog the regrade loaded.
  const skills = { ...round.skills, allBundles: round.skills.allBundles ?? round.skills.bundles.length === catalog.bundles.length };
  const regradedBy = { at: new Date().toISOString(), sha: runnerSha(repoRoot()), changed: out.changed, unhashed: out.unhashed, setApart: out.setApart, added: out.added };
  writeRoundOutputs(dir, { ...round, skills, regraded: regradedBy, summary: summariseRound(out.cases, out.records, notRun) });
  return 0;
}

const HELP = `skill-evals — run the published skills' eval cases on a with-skill and a no-skill arm
  pnpm --filter @objectstack/scenarios skill-evals [--skills a,b] [--skills-from workspace|VERSION] [--repeats N]
       [--concurrency N] [--max-turns N] [--case-timeout MIN] [--max-utilization F] [--model M] [--effort L]
       [--bin PATH] [--out DIR] [--triggers-only] [--trigger-field selection|own] [--dry-run] [--regrade DIR] [--self-test]
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
  const pf = args.dryRun || args.regrade ? undefined : preflight(args.bin, process.env, undefined, args.effort);
  const source = resolveSkillsSource(args.skillsFrom, repo);
  try {
    const catalog = loadSkillEvalCatalog(source.root);
    if (catalog.refusals.length) {
      for (const r of catalog.refusals) console.error(`${r.path}: ${r.message}`);
      throw new Error(`${catalog.refusals.length} eval file or case refused under ${source.root}; the runner grades only cases it can read whole`);
    }
    const catalogView = { bundles: catalog.bundles, unlisted: catalog.unlistedBundles };
    if (args.regrade) return regradeRound(resolve(args.regrade), catalog, source.label);
    // The competing set every trigger turn installs: the --skills bundles, or every bundle; `own` installs none beside.
    const triggerField = args.triggerField === 'own' ? undefined : [...new Set(args.skills?.length ? args.skills : catalog.bundles)];
    const cases = selectBundles(catalog, args.skills, args.triggersOnly, triggerField !== undefined);
    const jobs = planRound(cases, args.repeats);
    const bundles = [...new Set(cases.map((c) => c.bundle))];
    const turnOpts = { maxTurns: args.maxTurns, ...(args.model ? { model: args.model } : {}), ...(args.effort ? { effort: args.effort } : {}) };

    if (args.dryRun) {
      console.log(`skills: ${source.label} (${source.root})`);
      for (const b of bundles) console.log(`  ${b}: ${cases.filter((c) => c.bundle === b).length} case(s)`);
      const triggers = cases.filter((c) => c.shouldTrigger !== undefined);
      console.log(`${turnsLine(cases.length - triggers.length, triggers.length, args.repeats)} = ${jobs.length} turn(s), ${args.concurrency} at once`);
      if (args.triggersOnly) console.log(`--triggers-only: ${selectBundles(catalog, args.skills, false, triggerField !== undefined).length - cases.length} behaviour case(s) of these bundles left out`);
      if (triggers.length) console.log(`trigger cases: ${triggers.filter((c) => c.shouldTrigger).length} should load the bundle, ${triggers.filter((c) => !c.shouldTrigger).length} should not`);
      console.log(`each turn: a fresh directory holding the case's files; with-skill also holds .claude/skills/BUNDLE/ (no evals/)${args.triggersOnly ? '' : ', no-skill no skill'}`);
      if (triggers.length) console.log(triggerField ? `each trigger turn installs ${triggerField.length} bundle(s) (--trigger-field selection): ${triggerField.join(', ')}` : 'each trigger turn installs its own bundle alone (--trigger-field own)');
      console.log(`argv (prompt on stdin): ${args.bin} ${armArgs('TURN_DIR/mcp.json', turnOpts).join(' ')}`);
      console.log('dry run: no login read, no model called, nothing written');
      return 0;
    }

    if (!pf) throw new Error('unreachable: a live round has passed its preflight');
    // Read before the first turn: a commit landing while a long round runs is not the code that ran it.
    const sha = runnerSha(repo);
    const startedAt = new Date();
    const roundId = `${startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}-skill-evals`;
    const outDir = resolve(args.out ?? join(repo, 'docs', 'qa', 'platform-checklist', 'runs', 'skill-evals', roundId));
    mkdirSync(outDir, { recursive: true });
    if (existsSync(join(outDir, 'round.json'))) throw new Error(`${outDir} already holds a round.json: pass a fresh --out`);
    const triggerCount = cases.filter((c) => c.shouldTrigger !== undefined).length;
    console.log(`skill-evals: ${jobs.length} turn(s) (${turnsLine(cases.length - triggerCount, triggerCount, args.repeats)}), ${args.concurrency} at once, ${pf.version}, login ${pf.authMethod}`);
    console.log(`records: ${outDir}`);

    const exec = await executeRound(jobs, {
      bin: args.bin,
      skillsRoot: source.root,
      catalog: catalogView,
      outDir,
      maxTurns: args.maxTurns,
      caseTimeoutMs: Math.round(args.caseTimeoutMin * 60_000),
      concurrency: args.concurrency,
      maxUtilization: args.maxUtilization,
      ...(args.model ? { model: args.model } : {}),
      ...(args.effort ? { effort: args.effort } : {}),
      ...(triggerField ? { triggerField } : {}),
      onRecord: (r: SkillEvalRunRecord, done, total) => console.log(`[${done}/${total}] ${r.verdict.padEnd(7)} ${r.arm.padEnd(10)} ${r.key}${r.reason ? ` — ${r.reason}` : ''}`),
    });
    const finishedAt = new Date();
    const round: RoundRecord = {
      schema: ROUND_RECORD_SCHEMA,
      round: roundId,
      runner: { repo: 'objectstack-ai/objectstack', sha },
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      wallMs: finishedAt.getTime() - startedAt.getTime(),
      skills: { source: source.label, bundles, allBundles: bundles.length === catalog.bundles.length },
      driver: {
        driver: 'claude-code-cli',
        version: pf.version,
        authMethod: pf.authMethod,
        apiBilled: false,
        servedModels: [...new Set(exec.records.map((r) => r.model).filter((m): m is string => !!m))].sort(),
        ...(args.model ? { requestedModel: args.model } : {}),
        ...(args.effort ? { requestedEffort: args.effort } : {}),
        maxTurns: args.maxTurns,
        caseTimeoutMs: Math.round(args.caseTimeoutMin * 60_000),
        concurrency: args.concurrency,
        maxUtilization: args.maxUtilization,
      },
      scope: { cases: cases.length, arms: args.triggersOnly ? ['with-skill'] : [...ARMS], repeats: args.repeats, plannedTurns: jobs.length, ranTurns: exec.records.length, notRunTurns: exec.notRun.length, ...(args.triggersOnly ? { triggersOnly: true as const } : {}) },
      ...(triggerCount ? { triggerField: triggerField ? { mode: 'selection' as const, bundles: triggerField } : { mode: 'own' as const } } : {}),
      ...(exec.stopped ? { stopped: exec.stopped } : {}),
      summary: summariseRound(cases, exec.records, exec.notRun),
    };
    writeRoundOutputs(outDir, round);
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
