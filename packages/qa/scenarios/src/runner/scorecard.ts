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
 *     build must show up. Each bare item name is also listed as a finding.
 *   - Run-问数: one turn per (question, persona); it passes when the answer is
 *     correct AND cited AND leaks nothing. Leaks are also counted apart, so a
 *     leaking answer shows up even when it is otherwise right.
 *   - Run-operations: one per operation; it passes when its grade passes.
 *   - A turn that errored counts in the total and not in passed.
 */

import type { CardRun, ModeRun, RunHalf, BuildHalf } from './orchestrate.js';
import type { DriverInfo } from './driver.js';

export interface Tally {
  passed: number;
  total: number;
}

export interface HalfScores {
  build?: Tally & { degraded: boolean; failedCommands: string[] };
  ask?: Tally & { leaks: number };
  operations?: Tally;
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
  const failedCommands = b.commands.filter((c) => c.exit !== 0).map((c) => cmdName(c.command));
  const passed = b.score?.passed ?? 0;
  const total = b.score?.total ?? expectCount;
  return { passed, total, degraded: !b.score || failedCommands.length > 0 || passed < total, failedCommands };
}

export function askTally(r: RunHalf | undefined): HalfScores['ask'] | undefined {
  if (!r) return undefined;
  let passed = 0;
  let leaks = 0;
  for (const q of r.questions) {
    const g = q.grade;
    if (g && g.leaks.length) leaks++;
    if (g && g.correct && g.cited && g.leaks.length === 0) passed++;
  }
  return { passed, total: r.questions.length, leaks };
}

export function opsTally(r: RunHalf | undefined): Tally | undefined {
  if (!r) return undefined;
  return { passed: r.operations.filter((o) => o.grade?.pass).length, total: r.operations.length };
}

/** An artifact-less build scores 0 of 1 — a degraded build is never "nothing to score". */
const NO_ARTIFACT_TOTAL = 1;

/** One finding per bare item name a build declared, named per item. */
export function bareNameFindings(b: BuildHalf | undefined, half: string): string[] {
  return (b?.score?.naming ?? []).map((c) => `${half}: bare item name ${c.check.slice('bare-name:'.length).replace(':', ' ')} (${c.detail})`);
}

export function modeScorecard(m: ModeRun): ModeScorecard {
  const first: HalfScores = {};
  const b = buildTally(m.build, NO_ARTIFACT_TOTAL);
  if (b) first.build = b;
  const a = askTally(m.run);
  if (a) first.ask = a;
  const o = opsTally(m.run);
  if (o) first.operations = o;
  const out: ModeScorecard = {
    mode: m.mode,
    first,
    tags: (m.build?.score ?? m.iterate?.build.score)?.tags.map((t) => ({ tag: t.tag, status: t.status })) ?? [],
    findings: [...m.findings, ...bareNameFindings(m.build, 'build'), ...bareNameFindings(m.iterate?.build, 'iterate build')],
  };
  if (m.skipped) out.skipped = m.skipped;
  if (m.iterate) {
    const it: HalfScores & { changeSize?: number } = {};
    const ib = buildTally(m.iterate.build, NO_ARTIFACT_TOTAL);
    if (ib) it.build = ib;
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

const cell = (t: Tally | undefined) => (t ? `${t.passed}/${t.total}` : '—');

/** The scorecard as a markdown table: the modes side by side, one row per half. */
export function renderScorecard(sc: CardScorecard): string {
  const lines = [
    `### \`${sc.card}\` — ${sc.counts.questions} questions (${sc.counts.questionTurns} persona turns), ${sc.counts.operations} operations, ${sc.counts.personas} personas`,
    '',
    `| Half | ${sc.modes.map((m) => m.mode).join(' | ')} |`,
    `|:---|${sc.modes.map(() => ':---').join('|')}|`,
  ];
  const row = (label: string, f: (m: ModeScorecard) => string) => lines.push(`| ${label} | ${sc.modes.map((m) => (m.skipped ? `skipped` : f(m))).join(' | ')} |`);
  row('Build', (m) => (m.first.build ? `${cell(m.first.build)}${m.first.build.degraded ? ' ⚠ degraded' : ''}${m.first.build.failedCommands.length ? ` (failed: ${m.first.build.failedCommands.join(', ')})` : ''}` : '—'));
  row('Run-问数', (m) => (m.first.ask ? `${cell(m.first.ask)}${m.first.ask.leaks ? ` ⚠ ${m.first.ask.leaks} leaking` : ''}` : '—'));
  row('Run-operations', (m) => cell(m.first.operations));
  row('Iterate · Build', (m) => (m.iterate?.build ? `${cell(m.iterate.build)}${m.iterate.build.degraded ? ' ⚠ degraded' : ''}` : '—'));
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
    const halves: Array<[string, Tally | undefined, string | undefined, unknown[]]> = [
      ['build', s.first.build, m.build?.error, m.build?.score ? [...m.build.score.expect.checks, ...m.build.score.tags.flatMap((t) => t.checks), ...m.build.score.agentActions, ...m.build.score.naming] : []],
      ['run-ask', s.first.ask, m.run?.error, m.run?.questions ?? []],
      ['run-operations', s.first.operations, m.run?.error, m.run?.operations ?? []],
      ['iterate-build', s.iterate?.build, m.iterate?.build.error, m.iterate?.build.score ? [...m.iterate.build.score.expect.checks, ...m.iterate.build.score.naming] : []],
      ['iterate-run-ask', s.iterate?.ask, m.iterate?.run?.error, m.iterate?.run?.questions ?? []],
      ['iterate-run-operations', s.iterate?.operations, m.iterate?.run?.error, m.iterate?.run?.operations ?? []],
    ];
    for (const [half, tally, error, evidence] of halves) {
      results.push({
        id: `${cardRun.card}.${m.mode}.${half}`,
        verdict: m.skipped ? 'not-run' : verdictOf(tally, error),
        clauses: evidence.map((e, i) => ({ clause: i, evidence: e })),
        issues: [],
        notes: [tally ? `${tally.passed}/${tally.total}` : '', error ?? '', m.skipped ?? ''].filter(Boolean).join(' · '),
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
