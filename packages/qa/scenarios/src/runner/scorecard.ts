// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A card's run, summarized: the per-half scorecard (Build · Run-问数 ·
 * Run-operations · Iterate), the per-tag verdicts, the two modes side by side,
 * and the run record in the `docs/qa/platform-checklist/runs/` shape (records
 * are git-ignored output, never committed — that README).
 *
 * Counting rules, so a figure always means one thing:
 *
 *   - Build: the artifact score's counted checks (`expect`, scored tags, agent
 *     actions, and one failing check per bare item name); a build with no
 *     artifact is 0 of the card's `expect` count, never "not run" — a degraded
 *     build must show up. Each bare item name is also listed as a finding, and
 *     so is each reference cycle the build made required on every side (its
 *     seed cannot load it).
 *   - A build whose authoring turn did not finish — killed by the runner's
 *     timeout (`author timed out after N min`), or ended with no result line
 *     or an error result (`author turn failed: …`) — is NOT MEASURED, never a
 *     degraded score: nothing after it ran. The author row shows every
 *     authoring turn's `resultSubtype` and elapsed time.
 *   - Run-问数: one turn per (question, persona); it passes when the answer is
 *     correct AND cited AND leaks nothing. Leaks are also counted apart, so a
 *     leaking answer shows up even when it is otherwise right.
 *   - Run-operations: one per operation; it passes when its grade passes.
 *   - A turn that errored counts in the total and not in passed.
 *   - Seed: rows loaded of rows sent. A refused row is shown as
 *     `⚠ seed: N refused`, and every question turn and operation that depends
 *     on it (`seedDependence` in `orchestrate.ts`) is NOT MEASURED: it counts in
 *     neither passed nor total, and the cell says how many were left out. A
 *     half with nothing measured is `not-run` in the record, never `fail`.
 */

import type { CardRun, ModeRun, RunHalf, BuildHalf } from './orchestrate.js';
import type { DriverInfo } from './driver.js';
import { cycleText } from './seed.js';

export interface Tally {
  passed: number;
  total: number;
}

export interface HalfScores {
  build?: Tally & {
    degraded: boolean;
    failedCommands: string[];
    /** The authoring turn did not finish (`BuildHalf.notMeasured`): 0 of 0, never degraded. */
    notMeasuredReason?: string;
    author?: { resultSubtype?: string; elapsedMs?: number };
  };
  /** Rows the app took of the rows the runner sent. */
  seed?: { inserted: number; total: number; refused: number };
  ask?: Tally & { leaks: number; notMeasured: number };
  operations?: Tally & { notMeasured: number };
}

export interface ModeScorecard {
  mode: 'scratch' | 'template';
  skipped?: string;
  first: HalfScores;
  iterate?: HalfScores & { changeSize?: number };
  tags: Array<{ tag: string; status: string }>;
  findings: string[];
}

export interface CardScorecard {
  card: string;
  counts: CardRun['counts'];
  modes: ModeScorecard[];
}

const cmdName = (c: string) => c.replace(/^npx objectstack /, '').split(' ')[0]!;

export function buildTally(b: BuildHalf | undefined, expectCount: number): HalfScores['build'] | undefined {
  if (!b) return undefined;
  const author = b.author
    ? { ...(b.author.resultSubtype ? { resultSubtype: b.author.resultSubtype } : {}), ...(b.author.elapsedMs !== undefined ? { elapsedMs: b.author.elapsedMs } : {}) }
    : undefined;
  if (b.notMeasured) return { passed: 0, total: 0, degraded: false, failedCommands: [], notMeasuredReason: b.notMeasured, ...(author ? { author } : {}) };
  const failedCommands = b.commands.filter((c) => c.exit !== 0).map((c) => cmdName(c.command));
  const passed = b.score?.passed ?? 0;
  const total = b.score?.total ?? expectCount;
  return { passed, total, degraded: !b.score || failedCommands.length > 0 || passed < total, failedCommands, ...(author ? { author } : {}) };
}

export function seedTally(r: RunHalf | undefined): HalfScores['seed'] | undefined {
  if (!r) return undefined;
  return { inserted: r.seed.inserted, total: r.seed.inserted + r.seed.refused.length, refused: r.seed.refused.length };
}

export function askTally(r: RunHalf | undefined): HalfScores['ask'] | undefined {
  if (!r) return undefined;
  let passed = 0;
  let leaks = 0;
  const measured = r.questions.filter((q) => !q.notMeasured);
  for (const q of measured) {
    const g = q.grade;
    if (g && g.leaks.length) leaks++;
    if (g && g.correct && g.cited && g.leaks.length === 0) passed++;
  }
  return { passed, total: measured.length, leaks, notMeasured: r.questions.length - measured.length };
}

export function opsTally(r: RunHalf | undefined): HalfScores['operations'] | undefined {
  if (!r) return undefined;
  const measured = r.operations.filter((o) => !o.notMeasured);
  return { passed: measured.filter((o) => o.grade?.pass).length, total: measured.length, notMeasured: r.operations.length - measured.length };
}

/** An artifact-less build scores 0 of 1 — a degraded build is never "nothing to score". */
const NO_ARTIFACT_TOTAL = 1;

/** One finding per bare item name a build declared, named per item. */
export function bareNameFindings(b: BuildHalf | undefined, half: string): string[] {
  return (b?.score?.naming ?? []).map((c) => `${half}: bare item name ${c.check.slice('bare-name:'.length).replace(':', ' ')} (${c.detail})`);
}

/** One finding per reference cycle a build made required on every side, naming the cycle. */
export function requiredCycleFindings(b: BuildHalf | undefined, half: string): string[] {
  return (b?.requiredCycles ?? []).map(
    (c) => `${half}: the reference cycle ${cycleText(c)} is required on every side, so the seed cannot load it (at least one side of a reference cycle must be optional)`,
  );
}

export function modeScorecard(m: ModeRun): ModeScorecard {
  const first: HalfScores = {};
  const b = buildTally(m.build, NO_ARTIFACT_TOTAL);
  if (b) first.build = b;
  const sd = seedTally(m.run);
  if (sd) first.seed = sd;
  const a = askTally(m.run);
  if (a) first.ask = a;
  const o = opsTally(m.run);
  if (o) first.operations = o;
  const out: ModeScorecard = {
    mode: m.mode,
    first,
    tags: (m.build?.score ?? m.iterate?.build.score)?.tags.map((t) => ({ tag: t.tag, status: t.status })) ?? [],
    findings: [
      ...m.findings,
      ...bareNameFindings(m.build, 'build'),
      ...requiredCycleFindings(m.build, 'build'),
      ...bareNameFindings(m.iterate?.build, 'iterate build'),
      ...requiredCycleFindings(m.iterate?.build, 'iterate build'),
    ],
  };
  if (m.skipped) out.skipped = m.skipped;
  if (m.iterate) {
    const it: HalfScores & { changeSize?: number } = {};
    const ib = buildTally(m.iterate.build, NO_ARTIFACT_TOTAL);
    if (ib) it.build = ib;
    const isd = seedTally(m.iterate.run);
    if (isd) it.seed = isd;
    const ia = askTally(m.iterate.run);
    if (ia) it.ask = ia;
    const io = opsTally(m.iterate.run);
    if (io) it.operations = io;
    if (m.iterate.changeSize) it.changeSize = m.iterate.changeSize.total;
    out.iterate = it;
  }
  return out;
}

export function cardScorecard(run: CardRun): CardScorecard {
  return { card: run.card, counts: run.counts, modes: run.modes.map((m) => modeScorecard(m)) };
}

const cell = (t: (Tally & { notMeasured?: number }) | undefined) => (t ? `${t.passed}/${t.total}${t.notMeasured ? ` · ${t.notMeasured} not measured` : ''}` : '—');
const seedCell = (s: HalfScores['seed']) => (s ? `${s.inserted}/${s.total}${s.refused ? ` ⚠ seed: ${s.refused} refused` : ''}` : '—');

/** `42s`, `15m 00s`. */
export const elapsedText = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

const buildCell = (b: HalfScores['build']) =>
  !b ? '—' : b.notMeasuredReason ? `not measured: ${b.notMeasuredReason}` : `${cell(b)}${b.degraded ? ' ⚠ degraded' : ''}${b.failedCommands.length ? ` (failed: ${b.failedCommands.join(', ')})` : ''}`;
const authorCell = (b: HalfScores['build']) =>
  b?.author ? `${b.author.resultSubtype ?? '(no result)'} · ${b.author.elapsedMs !== undefined ? elapsedText(b.author.elapsedMs) : 'elapsed not recorded'}` : '—';

/** The scorecard as a markdown table: the modes side by side, one row per half. */
export function renderScorecard(sc: CardScorecard): string {
  const lines = [
    `### \`${sc.card}\` — ${sc.counts.questions} questions (${sc.counts.questionTurns} persona turns), ${sc.counts.operations} operations, ${sc.counts.personas} personas`,
    '',
    `| Half | ${sc.modes.map((m) => m.mode).join(' | ')} |`,
    `|:---|${sc.modes.map(() => ':---').join('|')}|`,
  ];
  const row = (label: string, f: (m: ModeScorecard) => string) => lines.push(`| ${label} | ${sc.modes.map((m) => (m.skipped ? `skipped` : f(m))).join(' | ')} |`);
  row('Build', (m) => buildCell(m.first.build));
  row('Build · author', (m) => authorCell(m.first.build));
  row('Seed', (m) => seedCell(m.first.seed));
  row('Run-问数', (m) => (m.first.ask ? `${cell(m.first.ask)}${m.first.ask.leaks ? ` ⚠ ${m.first.ask.leaks} leaking` : ''}` : '—'));
  row('Run-operations', (m) => cell(m.first.operations));
  row('Iterate · Build', (m) => buildCell(m.iterate?.build));
  row('Iterate · author', (m) => authorCell(m.iterate?.build));
  row('Iterate · Seed', (m) => seedCell(m.iterate?.seed));
  row('Iterate · Run-问数', (m) => (m.iterate?.ask ? `${cell(m.iterate.ask)}${m.iterate.ask.leaks ? ` ⚠ ${m.iterate.ask.leaks} leaking` : ''}` : '—'));
  row('Iterate · Run-operations', (m) => cell(m.iterate?.operations));
  row('AI change size (items)', (m) => (m.iterate?.changeSize !== undefined ? String(m.iterate.changeSize) : '—'));
  const tags = sc.modes.find((m) => m.tags.length)?.tags ?? [];
  if (tags.length) {
    lines.push('', '| Tag | ' + sc.modes.map((m) => m.mode).join(' | ') + ' |', '|:---|' + sc.modes.map(() => ':---').join('|') + '|');
    for (const t of tags) lines.push(`| \`${t.tag}\` | ${sc.modes.map((m) => m.tags.find((x) => x.tag === t.tag)?.status ?? '—').join(' | ')} |`);
  }
  for (const m of sc.modes) {
    if (m.skipped) lines.push('', `- ${m.mode}: skipped — ${m.skipped}`);
    for (const f of m.findings) lines.push(`- ${m.mode} finding: ${f}`);
  }
  return lines.join('\n');
}

// ── The run record (docs/qa/platform-checklist/runs/README.md shape) ────────

type Verdict = 'pass' | 'partial' | 'fail' | 'blocked' | 'not-run';

const verdictOf = (t: Tally | undefined, error?: string): Verdict =>
  error && !t ? 'blocked' : !t ? 'not-run' : t.total === 0 ? 'not-run' : t.passed === t.total ? 'pass' : t.passed === 0 ? 'fail' : 'partial';

export interface RunRecordMeta {
  run: string;
  date: string;
  framework?: string;
  driver: DriverInfo;
  runner: string;
  evidenceDir: string;
}

export function runRecord(meta: RunRecordMeta, cardRun: CardRun): Record<string, unknown> {
  const sc = cardScorecard(cardRun);
  const results: Array<Record<string, unknown>> = [];
  for (const m of cardRun.modes) {
    const s = sc.modes.find((x) => x.mode === m.mode)!;
    // A half that never ran because the build before it was not measured says so.
    const firstOut = m.build?.notMeasured ? `not run: the build was not measured (${m.build.notMeasured})` : undefined;
    const iterateOut = firstOut ?? (m.iterate?.build.notMeasured ? `not run: the iterate build was not measured (${m.iterate.build.notMeasured})` : undefined);
    const buildNote = (b: HalfScores['build']) => (b?.notMeasuredReason ? `not measured: ${b.notMeasuredReason}` : b ? cell(b) : '');
    const halves: Array<[string, Tally | undefined, string | undefined, unknown[], string]> = [
      ['build', s.first.build, m.build?.error, m.build?.score ? [...m.build.score.expect.checks, ...m.build.score.tags.flatMap((t) => t.checks), ...m.build.score.agentActions, ...m.build.score.naming] : [], buildNote(s.first.build)],
      ['run-ask', s.first.ask, m.run?.error, m.run?.questions ?? [], s.first.ask ? cell(s.first.ask) : (firstOut ?? '')],
      ['run-operations', s.first.operations, m.run?.error, m.run?.operations ?? [], s.first.operations ? cell(s.first.operations) : (firstOut ?? '')],
      ['iterate-build', s.iterate?.build, m.iterate?.build.error, m.iterate?.build.score ? [...m.iterate.build.score.expect.checks, ...m.iterate.build.score.naming] : [], s.iterate?.build ? buildNote(s.iterate.build) : (firstOut ?? '')],
      ['iterate-run-ask', s.iterate?.ask, m.iterate?.run?.error, m.iterate?.run?.questions ?? [], s.iterate?.ask ? cell(s.iterate.ask) : (iterateOut ?? '')],
      ['iterate-run-operations', s.iterate?.operations, m.iterate?.run?.error, m.iterate?.run?.operations ?? [], s.iterate?.operations ? cell(s.iterate.operations) : (iterateOut ?? '')],
    ];
    for (const [half, tally, error, evidence, note] of halves) {
      results.push({
        id: `${cardRun.card}.${m.mode}.${half}`,
        verdict: m.skipped ? 'not-run' : verdictOf(tally, error),
        clauses: evidence.map((e, i) => ({ clause: i, evidence: e })),
        issues: [],
        notes: [note, error ?? '', m.skipped ?? ''].filter(Boolean).join(' · '),
      });
    }
  }
  return {
    run: meta.run,
    date: meta.date,
    scope: `scenario card ${cardRun.card}`,
    app: cardRun.card,
    env: { framework: meta.framework ?? 'unknown', driver: meta.driver },
    runner: meta.runner,
    evidenceDir: meta.evidenceDir,
    results,
    scorecard: sc,
    cardRun,
  };
}
