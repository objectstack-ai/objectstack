// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A round's records read into what the ruling asks of it: per bundle, the pass
 * rate of each arm, the with-skill failures, and the cases where the no-skill
 * arm did at least as well as the with-skill arm; per case, both arms' full
 * scores. `invalid` and `error` turns, and turns a stopped round never ran,
 * are counted and named, and are never in a denominator. Pure over its inputs.
 */

import type { Arm } from './arms.js';
import type { SkillEvalCase } from './cases.js';
import type { RoundStop, SkillEvalRunRecord } from './run.js';

export interface ArmTally {
  pass: number;
  fail: number;
  invalid: number;
  error: number;
  notRun: number;
  /** `pass / (pass + fail)`; `null` ⇒ nothing measured. */
  rate: number | null;
}

export interface CaseScore {
  key: string;
  bundle: string;
  withSkill: ArmTally;
  noSkill: ArmTally;
  /** Tokens the with-skill arm missed or carried, over its failing turns (deduplicated). */
  withSkillMissing: string[];
  withSkillForbidden: string[];
}

export interface BundleSummary {
  bundle: string;
  cases: number;
  withSkill: ArmTally;
  noSkill: ArmTally;
  /** Cases with at least one failing with-skill turn. */
  withSkillFailures: string[];
  /** Cases measured on both arms where the no-skill rate is at or above the with-skill rate. */
  noSkillAtLeastWithSkill: string[];
}

export interface RoundSummary {
  bundles: BundleSummary[];
  cases: CaseScore[];
  totals: { withSkill: ArmTally; noSkill: ArmTally };
  reportedCostUsd: number;
}

const empty = (): ArmTally => ({ pass: 0, fail: 0, invalid: 0, error: 0, notRun: 0, rate: null });
const withRate = (t: ArmTally): ArmTally => ({ ...t, rate: t.pass + t.fail === 0 ? null : t.pass / (t.pass + t.fail) });
const add = (a: ArmTally, b: ArmTally): ArmTally => withRate({ pass: a.pass + b.pass, fail: a.fail + b.fail, invalid: a.invalid + b.invalid, error: a.error + b.error, notRun: a.notRun + b.notRun, rate: null });
const armKey = (arm: Arm) => (arm === 'with-skill' ? 'withSkill' : 'noSkill');

export function summariseRound(
  cases: readonly SkillEvalCase[],
  records: readonly SkillEvalRunRecord[],
  notRun: ReadonlyArray<{ case: SkillEvalCase; arm: Arm }>,
): RoundSummary {
  const byCase = new Map<string, CaseScore>();
  for (const c of cases) byCase.set(c.key, { key: c.key, bundle: c.bundle, withSkill: empty(), noSkill: empty(), withSkillMissing: [], withSkillForbidden: [] });
  let cost = 0;
  for (const r of records) {
    const s = byCase.get(r.key);
    if (!s) continue;
    s[armKey(r.arm)][r.verdict] += 1;
    if (r.reportedCostUsd !== undefined) cost += r.reportedCostUsd;
    if (r.arm === 'with-skill' && r.verdict === 'fail') {
      for (const t of r.missing) if (!s.withSkillMissing.includes(t)) s.withSkillMissing.push(t);
      for (const t of r.forbidden) if (!s.withSkillForbidden.includes(t)) s.withSkillForbidden.push(t);
    }
  }
  for (const j of notRun) {
    const s = byCase.get(j.case.key);
    if (s) s[armKey(j.arm)].notRun += 1;
  }
  const scores = [...byCase.values()].map((s) => ({ ...s, withSkill: withRate(s.withSkill), noSkill: withRate(s.noSkill) }));

  const bundleNames = [...new Set(scores.map((s) => s.bundle))].sort();
  const bundles = bundleNames.map((bundle): BundleSummary => {
    const mine = scores.filter((s) => s.bundle === bundle);
    return {
      bundle,
      cases: mine.length,
      withSkill: mine.reduce((t, s) => add(t, s.withSkill), empty()),
      noSkill: mine.reduce((t, s) => add(t, s.noSkill), empty()),
      withSkillFailures: mine.filter((s) => s.withSkill.fail > 0).map((s) => s.key),
      noSkillAtLeastWithSkill: mine.filter((s) => s.withSkill.rate !== null && s.noSkill.rate !== null && s.noSkill.rate >= s.withSkill.rate).map((s) => s.key),
    };
  });
  return {
    bundles,
    cases: scores,
    totals: { withSkill: bundles.reduce((t, b) => add(t, b.withSkill), empty()), noSkill: bundles.reduce((t, b) => add(t, b.noSkill), empty()) },
    reportedCostUsd: Math.round(cost * 100) / 100,
  };
}

const pct = (t: ArmTally) => (t.rate === null ? 'not measured' : `${t.pass}/${t.pass + t.fail} (${Math.round(t.rate * 100)}%)`);
const outOf = (t: ArmTally) => [t.invalid ? `${t.invalid} invalid` : '', t.error ? `${t.error} error` : '', t.notRun ? `${t.notRun} not run` : ''].filter(Boolean).join(', ') || '0';
/**
 * A token as a table cell. `forGitHub` spells the angle brackets out
 * (`(lt)` / `(gt)`): GitHub's body sanitizer eats a short tag-shaped fragment
 * even inside backticks, so a token like a JSX element name would vanish.
 */
const cell = (s: string, forGitHub: boolean) => {
  const t = s.replace(/`/g, "'").replace(/\|/g, '\\|');
  return '`' + (forGitHub ? t.replace(/</g, '(lt)').replace(/>/g, '(gt)') : t) + '`';
};

/** The round's summary as Markdown: the per-bundle table, then every case's scores on both arms. */
export function renderSummaryMarkdown(s: RoundSummary, head: { title: string; lines: string[]; stopped?: RoundStop }, opts: { forGitHub?: boolean } = {}): string {
  const code = (t: string) => cell(t, opts.forGitHub === true);
  const out: string[] = [`# ${head.title}`, '', ...head.lines.map((l) => `- ${l}`)];
  if (head.stopped) out.push(`- **Stopped** after ${head.stopped.afterRuns} turns: ${head.stopped.reason}`);
  out.push(
    '',
    '## Per bundle',
    '',
    '| bundle | cases | with-skill pass | no-skill pass | with-skill failing cases | no-skill ≥ with-skill | out of the denominator (with / no) |',
    '|:--|--:|--:|--:|--:|--:|:--|',
  );
  for (const b of s.bundles) {
    out.push(`| ${b.bundle} | ${b.cases} | ${pct(b.withSkill)} | ${pct(b.noSkill)} | ${b.withSkillFailures.length} | ${b.noSkillAtLeastWithSkill.length} | ${outOf(b.withSkill)} / ${outOf(b.noSkill)} |`);
  }
  out.push(`| **all** | ${s.cases.length} | ${pct(s.totals.withSkill)} | ${pct(s.totals.noSkill)} | ${s.bundles.reduce((n, b) => n + b.withSkillFailures.length, 0)} | ${s.bundles.reduce((n, b) => n + b.noSkillAtLeastWithSkill.length, 0)} | ${outOf(s.totals.withSkill)} / ${outOf(s.totals.noSkill)} |`);
  out.push('', '## Per case', '', '| case | with-skill | no-skill | with-skill missed | with-skill carried forbidden |', '|:--|--:|--:|:--|:--|');
  for (const c of s.cases) {
    out.push(`| ${c.key} | ${pct(c.withSkill)} | ${pct(c.noSkill)} | ${c.withSkillMissing.map(code).join(' ')} | ${c.withSkillForbidden.map(code).join(' ')} |`);
  }
  return out.join('\n') + '\n';
}
