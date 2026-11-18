// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A round's records read into what the ruling asks of it: per bundle, the pass
 * rate of each arm, the with-skill failures, and the cases where the no-skill
 * arm did at least as well as the with-skill arm; per case, both arms' full
 * scores. `invalid` and `error` turns, and turns a stopped round never ran,
 * are counted and named, and are never in a denominator. Trigger cases are
 * tallied apart, beside the behaviour cases and never inside their rates: per
 * bundle, how often the bundle was loaded when it should be and left alone
 * when it should not. Pure over its inputs.
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

/** One trigger case's with-skill turns: `pass` = loaded as `shouldTrigger` says. */
export interface TriggerCaseScore {
  key: string;
  bundle: string;
  shouldTrigger: boolean;
  tally: ArmTally;
  /** Judged turns that launched the bundle with the `Skill` tool. */
  loadedBySkillTool: number;
  /** Judged turns that only read a file under it (no `Skill` launch). */
  loadedByReadOnly: number;
}

export interface TriggerBundleSummary {
  bundle: string;
  cases: number;
  /** The `should_trigger: true` cases' turns: `pass` = loaded. */
  shouldTrigger: ArmTally;
  /** The `should_trigger: false` cases' turns: `pass` = left alone. */
  shouldNotTrigger: ArmTally;
  /** Positive cases with at least one turn that did not load the bundle. */
  missedLoads: string[];
  /** Negative cases with at least one turn that loaded it. */
  falseLoads: string[];
}

export interface TriggerSummary {
  bundles: TriggerBundleSummary[];
  cases: TriggerCaseScore[];
  totals: { shouldTrigger: ArmTally; shouldNotTrigger: ArmTally };
}

export interface RoundSummary {
  /** Behaviour cases only: trigger cases are in `triggers`. */
  bundles: BundleSummary[];
  cases: CaseScore[];
  totals: { withSkill: ArmTally; noSkill: ArmTally };
  triggers: TriggerSummary;
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
  for (const c of cases) if (c.shouldTrigger === undefined) byCase.set(c.key, { key: c.key, bundle: c.bundle, withSkill: empty(), noSkill: empty(), withSkillMissing: [], withSkillForbidden: [] });
  const byTrigger = new Map<string, TriggerCaseScore>();
  for (const c of cases) if (c.shouldTrigger !== undefined) byTrigger.set(c.key, { key: c.key, bundle: c.bundle, shouldTrigger: c.shouldTrigger, tally: empty(), loadedBySkillTool: 0, loadedByReadOnly: 0 });
  let cost = 0;
  for (const r of records) {
    const t = byTrigger.get(r.key);
    if (t) {
      if (r.reportedCostUsd !== undefined) cost += r.reportedCostUsd;
      t.tally[r.verdict] += 1;
      if (r.verdict === 'pass' || r.verdict === 'fail') {
        const by = r.trigger?.loadedBy ?? [];
        if (by.includes('skill-tool')) t.loadedBySkillTool += 1;
        else if (by.includes('read')) t.loadedByReadOnly += 1;
      }
      continue;
    }
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
    const t = byTrigger.get(j.case.key);
    if (t) t.tally.notRun += 1;
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
    triggers: summariseTriggers([...byTrigger.values()].map((t) => ({ ...t, tally: withRate(t.tally) }))),
    reportedCostUsd: Math.round(cost * 100) / 100,
  };
}

function summariseTriggers(scores: TriggerCaseScore[]): TriggerSummary {
  const failed = (t: TriggerCaseScore) => t.tally.fail > 0;
  const bundles = [...new Set(scores.map((s) => s.bundle))].sort().map((bundle): TriggerBundleSummary => {
    const mine = scores.filter((s) => s.bundle === bundle);
    const pos = mine.filter((s) => s.shouldTrigger);
    const neg = mine.filter((s) => !s.shouldTrigger);
    return {
      bundle,
      cases: mine.length,
      shouldTrigger: pos.reduce((t, s) => add(t, s.tally), empty()),
      shouldNotTrigger: neg.reduce((t, s) => add(t, s.tally), empty()),
      missedLoads: pos.filter(failed).map((s) => s.key),
      falseLoads: neg.filter(failed).map((s) => s.key),
    };
  });
  return {
    bundles,
    cases: scores,
    totals: { shouldTrigger: bundles.reduce((t, b) => add(t, b.shouldTrigger), empty()), shouldNotTrigger: bundles.reduce((t, b) => add(t, b.shouldNotTrigger), empty()) },
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
  const tr = s.triggers;
  if (tr.cases.length) {
    out.push(
      '',
      '## Trigger cases',
      '',
      'With-skill arm only. A turn loaded the bundle when it launched it with the `Skill` tool or read a file under it; the case passes when that matches `should_trigger`.',
      '',
      '| bundle | cases | loaded when it should | left alone when it should not load | missed loads | false loads | out of the denominator |',
      '|:--|--:|--:|--:|--:|--:|:--|',
    );
    for (const b of tr.bundles) {
      out.push(`| ${b.bundle} | ${b.cases} | ${pct(b.shouldTrigger)} | ${pct(b.shouldNotTrigger)} | ${b.missedLoads.length} | ${b.falseLoads.length} | ${outOf(add(b.shouldTrigger, b.shouldNotTrigger))} |`);
    }
    out.push(`| **all** | ${tr.cases.length} | ${pct(tr.totals.shouldTrigger)} | ${pct(tr.totals.shouldNotTrigger)} | ${tr.bundles.reduce((n, b) => n + b.missedLoads.length, 0)} | ${tr.bundles.reduce((n, b) => n + b.falseLoads.length, 0)} | ${outOf(add(tr.totals.shouldTrigger, tr.totals.shouldNotTrigger))} |`);
    out.push('', '| trigger case | should load | as it should | loaded by Skill / by reading only |', '|:--|:--|--:|:--|');
    for (const t of tr.cases) out.push(`| ${t.key} | ${t.shouldTrigger ? 'yes' : 'no'} | ${pct(t.tally)} | ${t.loadedBySkillTool} / ${t.loadedByReadOnly} |`);
  }
  return out.join('\n') + '\n';
}
